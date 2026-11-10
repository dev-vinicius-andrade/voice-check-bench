//! One instantiated effect: IComponent + IAudioProcessor + IEditController, connected like a regular host does.

use vst3::Steinberg::Vst::*;
use vst3::Steinberg::*;
use vst3::{ComPtr, ComWrapper};

use crate::com::{read_string128, tuid_hex, ComponentHandler, HostApp, MemStream};
use crate::module::{pump_messages, Module};

pub struct Plugin {
    pub component: ComPtr<IComponent>,
    pub processor: ComPtr<IAudioProcessor>,
    pub controller: Option<ComPtr<IEditController>>,
    pub single_component: bool,
    pub handler: ComWrapper<ComponentHandler>,
    connected: Option<(ComPtr<IConnectionPoint>, ComPtr<IConnectionPoint>)>,
    controller_initialized: bool,
}

pub struct Param {
    pub id: u32,
    pub title: String,
    pub units: String,
    pub step_count: i32,
    pub default_norm: f64,
    pub flags: i32,
    pub norm: f64,
    pub text: String,
    pub plain: f64,
}

pub fn tr(r: tresult) -> String {
    match r {
        x if x == kResultOk => "kResultOk".into(),
        x if x == kResultFalse => "kResultFalse".into(),
        x if x == kNotImplemented => "kNotImplemented".into(),
        x if x == kInvalidArgument => "kInvalidArgument".into(),
        x if x == kNoInterface => "kNoInterface".into(),
        x if x == kInternalError => "kInternalError".into(),
        x if x == kNotInitialized => "kNotInitialized".into(),
        x => format!("0x{:08X}", x as u32),
    }
}

impl Plugin {
    pub fn create(module: &Module, cid: &TUID, host: &ComWrapper<HostApp>) -> Result<Plugin, String> {
        let host_unknown = host.as_com_ref::<IHostApplication>().unwrap().as_ptr() as *mut FUnknown;
        let component: ComPtr<IComponent> = module.create(cid)?;
        println!("  createInstance(IComponent) OK");
        let r = unsafe { component.initialize(host_unknown) };
        println!("  IComponent::initialize(host) -> {}", tr(r));
        if r != kResultOk {
            return Err(format!("IComponent::initialize failed: {}", tr(r)));
        }
        let processor = component.cast::<IAudioProcessor>().ok_or("component has no IAudioProcessor")?;
        println!("  queryInterface(IAudioProcessor) OK");

        let handler = ComWrapper::new(ComponentHandler::default());
        let mut single_component = false;
        let mut controller_initialized = false;
        let controller = if let Some(c) = component.cast::<IEditController>() {
            single_component = true;
            println!("  component also implements IEditController (single-component effect)");
            Some(c)
        } else {
            let mut ccid: TUID = [0; 16];
            let r = unsafe { component.getControllerClassId(&mut ccid) };
            println!("  getControllerClassId -> {} cid={}", tr(r), tuid_hex(&ccid));
            if r == kResultOk {
                let c: ComPtr<IEditController> = module.create(&ccid)?;
                let r = unsafe { c.initialize(host_unknown) };
                println!("  createInstance(IEditController) OK; initialize(host) -> {}", tr(r));
                if r != kResultOk {
                    return Err(format!("IEditController::initialize failed: {}", tr(r)));
                }
                controller_initialized = true;
                Some(c)
            } else {
                None
            }
        };

        let mut connected = None;
        if let (Some(ctrl), false) = (&controller, single_component) {
            if let (Some(a), Some(b)) = (component.cast::<IConnectionPoint>(), ctrl.cast::<IConnectionPoint>()) {
                let r1 = unsafe { a.connect(b.as_ptr()) };
                let r2 = unsafe { b.connect(a.as_ptr()) };
                println!("  IConnectionPoint connect component->controller {} / controller->component {}", tr(r1), tr(r2));
                connected = Some((a, b));
            } else {
                println!("  IConnectionPoint not offered by both sides");
            }
            let hp = handler.as_com_ref::<IComponentHandler>().unwrap().as_ptr();
            let r = unsafe { ctrl.setComponentHandler(hp) };
            println!("  IEditController::setComponentHandler -> {}", tr(r));
        }
        pump_messages();
        Ok(Plugin { component, processor, controller, single_component, handler, connected, controller_initialized })
    }

    pub fn buses(&self) -> Vec<String> {
        let mut out = vec![];
        for (dir, dname) in [(BusDirections_::kInput, "in"), (BusDirections_::kOutput, "out")] {
            for (mt, mname) in [(MediaTypes_::kAudio, "audio"), (MediaTypes_::kEvent, "event")] {
                let n = unsafe { self.component.getBusCount(mt as MediaType, dir as BusDirection) };
                for i in 0..n {
                    let mut bi: BusInfo = unsafe { std::mem::zeroed() };
                    let r = unsafe { self.component.getBusInfo(mt as MediaType, dir as BusDirection, i, &mut bi) };
                    let mut arr: SpeakerArrangement = 0;
                    let ra = if mt == MediaTypes_::kAudio {
                        tr(unsafe { self.processor.getBusArrangement(dir as BusDirection, i, &mut arr) })
                    } else {
                        "-".into()
                    };
                    out.push(format!(
                        "{mname} {dname}[{i}] name={:?} channels={} busType={} flags=0x{:X} arrangement=0x{arr:X} ({ra}) info={}",
                        read_string128(&bi.name),
                        bi.channelCount,
                        bi.busType,
                        bi.flags,
                        tr(r)
                    ));
                }
            }
        }
        out
    }

    pub fn params(&self) -> Vec<Param> {
        let Some(c) = &self.controller else { return vec![] };
        let n = unsafe { c.getParameterCount() };
        let mut out = vec![];
        for i in 0..n {
            let mut pi: ParameterInfo = unsafe { std::mem::zeroed() };
            if unsafe { c.getParameterInfo(i, &mut pi) } != kResultOk {
                continue;
            }
            let norm = unsafe { c.getParamNormalized(pi.id) };
            let mut s: String128 = [0; 128];
            let text = if unsafe { c.getParamStringByValue(pi.id, norm, &mut s) } == kResultOk { read_string128(&s) } else { "<no string>".into() };
            let plain = unsafe { c.normalizedParamToPlain(pi.id, norm) };
            out.push(Param {
                id: pi.id,
                title: read_string128(&pi.title),
                units: read_string128(&pi.units),
                step_count: pi.stepCount,
                default_norm: pi.defaultNormalizedValue,
                flags: pi.flags,
                norm,
                text,
                plain,
            });
        }
        out
    }

    pub fn component_get_state(&self) -> (tresult, Vec<u8>) {
        let s = ComWrapper::new(MemStream::default());
        let r = unsafe { self.component.getState(s.as_com_ref::<IBStream>().unwrap().as_ptr()) };
        (r, s.bytes())
    }

    pub fn controller_get_state(&self) -> Option<(tresult, Vec<u8>)> {
        let c = self.controller.as_ref()?;
        let s = ComWrapper::new(MemStream::default());
        let r = unsafe { c.getState(s.as_com_ref::<IBStream>().unwrap().as_ptr()) };
        Some((r, s.bytes()))
    }

    /// What a JUCE host (Wave Link) does in VST3PluginInstance::setStateInformation:
    /// IComponent::setState(component bytes), rewind, IEditController::setComponentState(same bytes),
    /// then IEditController::setState(controller bytes) when present.
    pub fn apply_state(&self, component: &[u8], controller: Option<&[u8]>) -> Vec<(String, String)> {
        let mut log = vec![];
        let s = ComWrapper::new(MemStream::from_bytes(component));
        let sp = s.as_com_ref::<IBStream>().unwrap().as_ptr();
        let r = unsafe { self.component.setState(sp) };
        log.push(("IComponent::setState".to_string(), tr(r)));
        pump_messages();
        if let Some(c) = &self.controller {
            let s2 = ComWrapper::new(MemStream::from_bytes(component));
            let r = unsafe { c.setComponentState(s2.as_com_ref::<IBStream>().unwrap().as_ptr()) };
            log.push(("IEditController::setComponentState".to_string(), tr(r)));
            if let Some(cb) = controller {
                let s3 = ComWrapper::new(MemStream::from_bytes(cb));
                let r = unsafe { c.setState(s3.as_com_ref::<IBStream>().unwrap().as_ptr()) };
                log.push(("IEditController::setState".to_string(), tr(r)));
            }
        }
        pump_messages();
        log
    }

    pub fn shutdown(self) {
        unsafe {
            if let Some((a, b)) = &self.connected {
                a.disconnect(b.as_ptr());
                b.disconnect(a.as_ptr());
            }
            if let (Some(c), false) = (&self.controller, self.single_component) {
                if self.controller_initialized {
                    c.terminate();
                }
            }
            self.component.terminate();
        }
        pump_messages();
    }
}
