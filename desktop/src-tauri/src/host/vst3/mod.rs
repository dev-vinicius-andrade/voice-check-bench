//! VST3 hosting for the Elgato Wave Link effects (Noise Removal, EQ, De-Esser, Compressor), with the `vst3` crate.
//! Port of `spike/vst3-probe`. Create, control and drop on the host thread (JUCE message thread); `process` may run
//! on the audio thread.

pub mod com;
pub mod module;
pub mod state;

use std::cell::UnsafeCell;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use vst3::Steinberg::Vst::ParameterInfo_::ParameterFlags_;
use vst3::Steinberg::Vst::*;
use vst3::Steinberg::*;
use vst3::{ComPtr, ComWrapper};

use self::com::{read_string128, ComponentHandler, HostApp, MemStream, ParamMailbox, RtChanges};
use self::module::{juce_plugin_ids, Module};
use super::thread::{is_host_thread, pump_messages};
use super::{HostResult, ParamInfo, BLOCK, NOISE_REMOVAL_EXTRA_LATENCY, SAMPLE_RATE};

/// JUCE uniqueId (Wave Link PluginId) of Elgato Noise Removal's audio module class.
pub const NOISE_REMOVAL_PLUGIN_ID: u32 = 0xf4a9_d925;

/// Audio buses and their buffers, built once at activation; touched only by `process` (exclusive).
struct Rt {
    in_bufs: Vec<Vec<Vec<f32>>>,
    out_bufs: Vec<Vec<Vec<f32>>>,
    // Pointer tables the AudioBusBuffers point into; never reallocated after activation.
    _in_ptrs: Vec<Vec<*mut f32>>,
    _out_ptrs: Vec<Vec<*mut f32>>,
    in_bus: Vec<AudioBusBuffers>,
    out_bus: Vec<AudioBusBuffers>,
}

pub struct Vst3Plugin {
    name: String,
    path: PathBuf,
    plugin_id: u32,
    extra_latency: u32,
    latency: AtomicU32,
    bypass_ids: Vec<u32>,
    mailbox: Arc<ParamMailbox>,
    changes: ComWrapper<RtChanges>,
    rt: UnsafeCell<Rt>,
    handler: ComWrapper<ComponentHandler>,
    connected: Option<(ComPtr<IConnectionPoint>, ComPtr<IConnectionPoint>)>,
    controller: Option<ComPtr<IEditController>>,
    /// The controller is a separate object we initialized (terminate it on drop).
    separate_controller: bool,
    processor: ComPtr<IAudioProcessor>,
    component: ComPtr<IComponent>,
    _host: ComWrapper<HostApp>,
    // Last: the factory is released and ExitDll runs after every plugin object above.
    _module: Module,
}

// SAFETY: COM pointers and buffers owned by this value; moving it between threads is fine. Its methods document
// which thread they belong to (host thread for control, one audio thread for `process`); `chain` enforces that.
unsafe impl Send for Vst3Plugin {}

fn arrangement_channels(a: SpeakerArrangement) -> usize {
    a.count_ones() as usize
}

impl Vst3Plugin {
    /// Load the module, create the "Audio Module Class" with its controller, connect them, and activate it for
    /// mono 48 kHz / 480 realtime processing. Must run on the host thread.
    pub fn load(path: &Path, name: &str) -> HostResult<Vst3Plugin> {
        if !is_host_thread() {
            return Err(
                format!("{name}: VST3 plugins must be created on the plugin host thread").into(),
            );
        }
        let module = Module::load(path)?;
        let host = ComWrapper::new(HostApp {
            name: "Voice Check Bench".into(),
        });
        let host_unknown = host
            .as_com_ref::<IHostApplication>()
            .ok_or("host COM ref")?
            .as_ptr() as *mut FUnknown;
        if let Some(f3) = module.factory.cast::<IPluginFactory3>() {
            unsafe { f3.setHostContext(host_unknown) };
        }
        let class = module
            .classes()
            .into_iter()
            .find(|c| c.category == "Audio Module Class")
            .ok_or_else(|| format!("{name}: no 'Audio Module Class'"))?;
        let (plugin_id, _) = juce_plugin_ids(&class.cid.map(|b| b as u8));
        let is_noise_removal =
            plugin_id == NOISE_REMOVAL_PLUGIN_ID || class.name.contains("Noise Removal");

        let component: ComPtr<IComponent> = module
            .create(&class.cid)
            .map_err(|e| format!("{name}: {e}"))?;
        if unsafe { component.initialize(host_unknown) } != kResultOk {
            return Err(format!("{name}: IComponent::initialize failed").into());
        }
        let processor = component
            .cast::<IAudioProcessor>()
            .ok_or_else(|| format!("{name}: no IAudioProcessor"))?;
        let handler = ComWrapper::new(ComponentHandler::default());
        let mut separate_controller = false;
        let controller = match component.cast::<IEditController>() {
            Some(c) => Some(c),
            None => {
                let mut ccid: TUID = [0; 16];
                if unsafe { component.getControllerClassId(&mut ccid) } == kResultOk {
                    let c: ComPtr<IEditController> = module
                        .create(&ccid)
                        .map_err(|e| format!("{name} controller: {e}"))?;
                    if unsafe { c.initialize(host_unknown) } != kResultOk {
                        return Err(format!("{name}: IEditController::initialize failed").into());
                    }
                    separate_controller = true;
                    Some(c)
                } else {
                    None
                }
            }
        };
        let mut connected = None;
        if let Some(ctrl) = &controller {
            if separate_controller {
                if let (Some(a), Some(b)) = (
                    component.cast::<IConnectionPoint>(),
                    ctrl.cast::<IConnectionPoint>(),
                ) {
                    unsafe {
                        a.connect(b.as_ptr());
                        b.connect(a.as_ptr());
                    }
                    connected = Some((a, b));
                }
            }
            if let Some(h) = handler.as_com_ref::<IComponentHandler>() {
                unsafe { ctrl.setComponentHandler(h.as_ptr()) };
            }
        }
        pump_messages();

        let infos = controller.as_ref().map(param_infos).unwrap_or_default();
        let mailbox = Arc::new(ParamMailbox::new(infos.iter().map(|p| p.id)));
        let _ = handler.mailbox.set(mailbox.clone());
        let bypass_ids = infos
            .iter()
            .filter(|p| is_bypass_param(p))
            .map(|p| p.id)
            .collect();
        let changes = ComWrapper::new(RtChanges::with_capacity(mailbox.len()));
        let rt = activate(&component, &processor).map_err(|e| format!("{name}: {e}"))?;
        let extra_latency = if is_noise_removal {
            NOISE_REMOVAL_EXTRA_LATENCY
        } else {
            0
        };
        let p = Vst3Plugin {
            name: name.to_string(),
            path: path.to_path_buf(),
            plugin_id,
            extra_latency,
            latency: AtomicU32::new(0),
            bypass_ids,
            mailbox,
            changes,
            rt: UnsafeCell::new(rt),
            handler,
            connected,
            controller,
            separate_controller,
            processor,
            component,
            _host: host,
            _module: module,
        };
        p.refresh_latency();
        pump_messages();
        Ok(p)
    }

    /// Reported latency, plus the unreported Noise Removal delay while it really processes: with its own bypass on
    /// it passes audio through undelayed (measured). The value switches as soon as the bypass parameter changes;
    /// the plugin follows within [`super::SETTLE`].
    fn refresh_latency(&self) {
        let reported = unsafe { self.processor.getLatencySamples() };
        let extra = if self.own_bypass_on() {
            0
        } else {
            self.extra_latency
        };
        self.latency.store(reported + extra, Ordering::Release);
    }

    /// True when any of the plugin's bypass parameters is on (controller value).
    pub fn own_bypass_on(&self) -> bool {
        match &self.controller {
            Some(c) => self
                .bypass_ids
                .iter()
                .any(|id| unsafe { c.getParamNormalized(*id) } >= 0.5),
            None => false,
        }
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn file_path(&self) -> &Path {
        &self.path
    }

    /// JUCE uniqueId of the audio module class (Wave Link `PluginId`).
    pub fn plugin_id(&self) -> u32 {
        self.plugin_id
    }

    pub fn latency_samples(&self) -> u32 {
        self.latency.load(Ordering::Acquire)
    }

    /// Flags of the last `restartComponent` the plugin asked for (0 when none).
    pub fn last_restart_flags(&self) -> i32 {
        self.handler.last_restart_flags.load(Ordering::Relaxed)
    }

    pub fn params(&self) -> Vec<ParamInfo> {
        let Some(c) = &self.controller else {
            return vec![];
        };
        param_infos(c)
            .into_iter()
            .map(|pi| {
                let norm = unsafe { c.getParamNormalized(pi.id) };
                let mut s: String128 = [0; 128];
                let text = if unsafe { c.getParamStringByValue(pi.id, norm, &mut s) } == kResultOk {
                    read_string128(&s)
                } else {
                    String::new()
                };
                let units = read_string128(&pi.units);
                ParamInfo {
                    id: pi.id,
                    name: read_string128(&pi.title),
                    display: format!("{text} {units}").trim().to_string(),
                    normalized: norm,
                    is_bypass: is_bypass_param(&pi),
                }
            })
            .collect()
    }

    pub fn param(&self, id: u32) -> Option<f64> {
        let c = self.controller.as_ref()?;
        param_infos(c)
            .iter()
            .any(|p| p.id == id)
            .then(|| unsafe { c.getParamNormalized(id) })
    }

    /// Controller value now (display, and JUCE updates its processor when not playing), processor at the next block.
    pub fn set_param(&self, id: u32, normalized: f64) -> HostResult<()> {
        let v = normalized.clamp(0.0, 1.0);
        if !self.mailbox.post(id, v) {
            return Err(format!("{}: no parameter {id}", self.name).into());
        }
        if let Some(c) = &self.controller {
            unsafe { c.setParamNormalized(id, v) };
        }
        if self.bypass_ids.contains(&id) {
            self.refresh_latency();
        }
        Ok(())
    }

    pub fn has_own_bypass(&self) -> bool {
        !self.bypass_ids.is_empty()
    }

    /// Every bypass parameter (the plugin's own "bypass" and the JUCE wrapper Bypass) to `on`.
    pub fn set_bypass(&self, on: bool) -> HostResult<bool> {
        for id in &self.bypass_ids {
            self.set_param(*id, if on { 1.0 } else { 0.0 })?;
        }
        Ok(self.has_own_bypass())
    }

    /// What JUCE's VST3PluginInstance::setStateInformation does: IComponent::setState, then
    /// IEditController::setComponentState with the same bytes, then IEditController::setState when present.
    /// Pending parameter changes are dropped so they cannot override the loaded state. Exclusive.
    pub fn load_state(&self, parameter_state: &str) -> HostResult<()> {
        let st = state::decode_parameter_state(parameter_state)
            .map_err(|e| format!("{}: {e}", self.name))?;
        let comp = st
            .component
            .ok_or_else(|| format!("{}: ParameterState has no IComponent state", self.name))?;
        let s = ComWrapper::new(MemStream::from_bytes(&comp));
        let r = unsafe {
            self.component
                .setState(s.as_com_ref::<IBStream>().ok_or("stream COM ref")?.as_ptr())
        };
        if r != kResultOk {
            return Err(format!(
                "{}: IComponent::setState failed (0x{:08X})",
                self.name, r as u32
            )
            .into());
        }
        pump_messages();
        if let Some(c) = &self.controller {
            let s2 = ComWrapper::new(MemStream::from_bytes(&comp));
            if let Some(r) = s2.as_com_ref::<IBStream>() {
                // Elgato controllers answer kNotImplemented; their parameters follow through restartComponent.
                unsafe { c.setComponentState(r.as_ptr()) };
            }
            if let Some(cb) = &st.controller {
                let s3 = ComWrapper::new(MemStream::from_bytes(cb));
                if let Some(r) = s3.as_com_ref::<IBStream>() {
                    unsafe { c.setState(r.as_ptr()) };
                }
            }
        }
        pump_messages();
        self.mailbox.clear();
        self.refresh_latency();
        Ok(())
    }

    /// IComponent::getState (plus IEditController::getState when it succeeds) wrapped as Wave Link stores it. Exclusive.
    pub fn save_state(&self) -> HostResult<String> {
        let s = ComWrapper::new(MemStream::default());
        let r = unsafe {
            self.component
                .getState(s.as_com_ref::<IBStream>().ok_or("stream COM ref")?.as_ptr())
        };
        if r != kResultOk {
            return Err(format!(
                "{}: IComponent::getState failed (0x{:08X})",
                self.name, r as u32
            )
            .into());
        }
        let ctrl = self.controller.as_ref().and_then(|c| {
            let s = ComWrapper::new(MemStream::default());
            let r = unsafe { c.getState(s.as_com_ref::<IBStream>()?.as_ptr()) };
            (r == kResultOk).then(|| s.bytes())
        });
        Ok(state::encode_parameter_state(
            Some(&s.bytes()),
            ctrl.as_deref(),
        ))
    }

    /// Mono in → every channel of the main input bus → channel 0 of the main output bus. Pending parameter changes
    /// go in as IParameterChanges at offset 0. Real-time safe (no allocation, no locks).
    pub fn process(&self, input: &[f32], output: &mut [f32]) {
        let n = input.len().min(BLOCK).min(output.len());
        // SAFETY: `process` is exclusive (see host/mod.rs), so nothing else touches the buffers now.
        let rt = unsafe { &mut *self.rt.get() };
        for (b, bus) in rt.in_bufs.iter_mut().enumerate() {
            for ch in bus.iter_mut() {
                if b == 0 {
                    ch[..n].copy_from_slice(&input[..n]);
                } else {
                    ch[..n].fill(0.0);
                }
            }
        }
        for ch in rt.out_bufs.iter_mut().flatten() {
            ch[..n].fill(0.0);
        }
        for bb in rt.in_bus.iter_mut().chain(rt.out_bus.iter_mut()) {
            bb.silenceFlags = 0;
        }
        let pending = self.changes.fill(&self.mailbox);
        let changes = match (pending > 0, self.changes.as_com_ref::<IParameterChanges>()) {
            (true, Some(r)) => r.as_ptr(),
            _ => std::ptr::null_mut(),
        };
        let mut data = ProcessData {
            processMode: ProcessModes_::kRealtime as int32,
            symbolicSampleSize: SymbolicSampleSizes_::kSample32 as int32,
            numSamples: n as int32,
            numInputs: rt.in_bus.len() as int32,
            numOutputs: rt.out_bus.len() as int32,
            inputs: rt.in_bus.as_mut_ptr(),
            outputs: rt.out_bus.as_mut_ptr(),
            inputParameterChanges: changes,
            outputParameterChanges: std::ptr::null_mut(),
            inputEvents: std::ptr::null_mut(),
            outputEvents: std::ptr::null_mut(),
            processContext: std::ptr::null_mut(),
        };
        unsafe { self.processor.process(&mut data) };
        match rt.out_bufs.first().and_then(|b| b.first()) {
            Some(ch) => output[..n].copy_from_slice(&ch[..n]),
            None => output[..n].copy_from_slice(&input[..n]),
        }
    }
}

impl Drop for Vst3Plugin {
    fn drop(&mut self) {
        unsafe {
            self.processor.setProcessing(0);
            self.component.setActive(0);
            if let Some((a, b)) = &self.connected {
                a.disconnect(b.as_ptr());
                b.disconnect(a.as_ptr());
            }
            if let (Some(c), true) = (&self.controller, self.separate_controller) {
                c.terminate();
            }
            self.component.terminate();
        }
        pump_messages();
    }
}

fn param_infos(c: &ComPtr<IEditController>) -> Vec<ParameterInfo> {
    let n = unsafe { c.getParameterCount() };
    (0..n)
        .filter_map(|i| {
            let mut pi: ParameterInfo = unsafe { std::mem::zeroed() };
            (unsafe { c.getParameterInfo(i, &mut pi) } == kResultOk).then_some(pi)
        })
        .collect()
}

/// The wrapper bypass (`kIsBypass`) or the plugin's own parameter titled "Bypass" (Noise Removal, Compressor).
fn is_bypass_param(p: &ParameterInfo) -> bool {
    p.flags & ParameterFlags_::kIsBypass != 0
        || read_string128(&p.title).eq_ignore_ascii_case("bypass")
}

/// Bus setup as the spike did it: mono main buses (stereo fallback), main buses active, realtime 48 kHz / 480,
/// setActive + setProcessing, and preallocated buffers for every bus.
fn activate(
    component: &ComPtr<IComponent>,
    processor: &ComPtr<IAudioProcessor>,
) -> Result<Rt, String> {
    let audio = MediaTypes_::kAudio as MediaType;
    let (dir_in, dir_out) = (
        BusDirections_::kInput as BusDirection,
        BusDirections_::kOutput as BusDirection,
    );
    let n_in = unsafe { component.getBusCount(audio, dir_in) };
    let n_out = unsafe { component.getBusCount(audio, dir_out) };
    let current = |dir: BusDirection, n: i32| -> Vec<SpeakerArrangement> {
        (0..n)
            .map(|i| {
                let mut a = 0;
                unsafe { processor.getBusArrangement(dir, i, &mut a) };
                a
            })
            .collect()
    };
    let mut channels = 0;
    for arr in [SpeakerArr::kMono, SpeakerArr::kStereo] {
        let mut ins = current(dir_in, n_in);
        let mut outs = current(dir_out, n_out);
        if let Some(x) = ins.first_mut() {
            *x = arr;
        }
        if let Some(x) = outs.first_mut() {
            *x = arr;
        }
        let r = unsafe {
            processor.setBusArrangements(ins.as_mut_ptr(), n_in, outs.as_mut_ptr(), n_out)
        };
        if r == kResultOk
            && current(dir_in, n_in).first() == Some(&arr)
            && current(dir_out, n_out).first() == Some(&arr)
        {
            channels = arrangement_channels(arr);
            break;
        }
    }
    if channels == 0 {
        channels = current(dir_out, n_out)
            .first()
            .map(|a| arrangement_channels(*a))
            .unwrap_or(2)
            .max(1);
    }
    for i in 0..n_in {
        unsafe { component.activateBus(audio, dir_in, i, (i == 0) as TBool) };
    }
    for i in 0..n_out {
        unsafe { component.activateBus(audio, dir_out, i, (i == 0) as TBool) };
    }
    let mut setup = ProcessSetup {
        processMode: ProcessModes_::kRealtime as int32,
        symbolicSampleSize: SymbolicSampleSizes_::kSample32 as int32,
        maxSamplesPerBlock: BLOCK as int32,
        sampleRate: SAMPLE_RATE as f64,
    };
    if unsafe { processor.setupProcessing(&mut setup) } != kResultOk {
        return Err("setupProcessing failed".into());
    }
    if unsafe { component.setActive(1) } != kResultOk {
        return Err("setActive failed".into());
    }
    unsafe { processor.setProcessing(1) };

    let bus_ch = |dir: BusDirection, n: i32| -> Vec<usize> {
        current(dir, n)
            .iter()
            .enumerate()
            .map(|(i, a)| {
                if i == 0 {
                    channels
                } else {
                    arrangement_channels(*a)
                }
            })
            .collect()
    };
    let mut in_bufs: Vec<Vec<Vec<f32>>> = bus_ch(dir_in, n_in)
        .iter()
        .map(|c| vec![vec![0f32; BLOCK]; *c])
        .collect();
    let mut out_bufs: Vec<Vec<Vec<f32>>> = bus_ch(dir_out, n_out)
        .iter()
        .map(|c| vec![vec![0f32; BLOCK]; *c])
        .collect();
    let mut in_ptrs: Vec<Vec<*mut f32>> = in_bufs
        .iter_mut()
        .map(|b| b.iter_mut().map(|c| c.as_mut_ptr()).collect())
        .collect();
    let mut out_ptrs: Vec<Vec<*mut f32>> = out_bufs
        .iter_mut()
        .map(|b| b.iter_mut().map(|c| c.as_mut_ptr()).collect())
        .collect();
    let bus = |p: &mut Vec<*mut f32>| AudioBusBuffers {
        numChannels: p.len() as int32,
        silenceFlags: 0,
        __field0: AudioBusBuffers__type0 {
            channelBuffers32: p.as_mut_ptr(),
        },
    };
    let in_bus = in_ptrs.iter_mut().map(bus).collect();
    let out_bus = out_ptrs.iter_mut().map(bus).collect();
    Ok(Rt {
        in_bufs,
        out_bufs,
        _in_ptrs: in_ptrs,
        _out_ptrs: out_ptrs,
        in_bus,
        out_bus,
    })
}
