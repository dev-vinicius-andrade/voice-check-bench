// Load Wave Link's ReaPlugs entries as VST2 instances with their stored state, export state the way JUCE / Wave Link
// stores it, and run a mono signal through the chain.
use std::path::Path;

use anyhow::{Context, Result, bail};

use crate::fxb::{self, Body, Program};
use crate::settings::Entry;
use crate::vst::{Plugin, fourcc};

/// Load the stored .fxb into the plugin like JUCE's loadFromFXBFile: FBCh -> effSetChunk(bank),
/// FxBk -> program name + setParameter for every value of the current program.
pub fn apply_state(p: &mut Plugin, blob: &[u8]) -> Result<fxb::Fxb> {
    let f = fxb::parse(blob)?;
    if f.fx_id != p.unique_id() {
        bail!("{}: fxID {} != plugin uniqueID {}", p.label, fourcc(f.fx_id), fourcc(p.unique_id()));
    }
    match &f.body {
        Body::Chunk(c) => {
            if !p.uses_chunks() {
                bail!("{}: stored FBCh but plugin has no effFlagsProgramChunks", p.label);
            }
            p.set_chunk(c, false);
        }
        Body::Bank(progs) => {
            let cur = p.program().max(0) as usize;
            let prog = progs.get(cur).unwrap_or(&progs[0]);
            p.set_program_name(prog.name.split(|&b| b == 0).next().unwrap_or(&[]));
            for (k, v) in prog.params.iter().enumerate() {
                p.set_param(k as i32, *v);
            }
        }
    }
    Ok(f)
}

/// Export the plugin state as JUCE's saveToFXBFile(isFXB = true) would (= what Wave Link writes).
pub fn export_state(p: &mut Plugin) -> Vec<u8> {
    let num_programs = p.num_programs();
    let body = if p.uses_chunks() {
        Body::Chunk(p.get_chunk(false))
    } else {
        let mut name = [0u8; 28];
        let pn = p.program_name();
        let n = pn.len().min(27);
        name[..n].copy_from_slice(&pn.as_bytes()[..n]);
        let params = (0..p.num_params()).map(|k| p.get_param(k)).collect();
        // Wave Link's ReaPlugs have numPrograms 1; multi-program banks would need setProgram per program.
        Body::Bank(vec![Program { name, params }; num_programs.max(1) as usize])
    };
    fxb::build(p.unique_id(), p.version(), num_programs, &body)
}

pub struct Chain {
    pub plugins: Vec<Plugin>,
    /// How many plugin inputs get the mono signal (1 = left only, 2 = left and right).
    pub feed: usize,
    pub max_block: usize,
    scratch: Vec<f32>,
}

/// "ReaGate:9=0;ReaComp:11=3.98" -> [(name, param index, value)]
pub fn parse_sets(spec: &str) -> Result<Vec<(String, i32, f32)>> {
    spec.split(';')
        .filter(|s| !s.trim().is_empty())
        .map(|s| {
            let (name, rest) = s.split_once(':').context("NAME:IDX=VALUE")?;
            let (idx, val) = rest.split_once('=').context("NAME:IDX=VALUE")?;
            Ok((name.trim().to_string(), idx.trim().parse()?, val.trim().parse()?))
        })
        .collect()
}

/// Active (BypassState false) ReaPlugs on the mic input, in Settings.json order, with their stored state, resumed.
/// `sets` are setParameter overrides applied after the stored state (live tuning).
pub fn build_chain(
    entries: &[Entry],
    sample_rate: f32,
    max_block: usize,
    feed: usize,
    only: Option<&str>,
    sets: &[(String, i32, f32)],
) -> Result<Chain> {
    let mut plugins = vec![];
    for e in entries.iter().filter(|e| e.is_reaplug() && !e.bypass) {
        if let Some(o) = only {
            if !o.split(',').any(|w| e.short().eq_ignore_ascii_case(w.trim())) {
                continue;
            }
        }
        let mut p = Plugin::load(Path::new(&e.file_path), e.short())?;
        p.setup(sample_rate, max_block);
        apply_state(&mut p, &e.blob()?)?;
        for (_, k, v) in sets.iter().filter(|s| s.0.eq_ignore_ascii_case(e.short())) {
            p.set_param(*k, *v);
            println!("  set {} param {} \"{}\" = {} -> {} {}", e.short(), k, p.param_name(*k), v, p.param_display(*k), p.param_label(*k));
        }
        p.resume();
        plugins.push(p);
    }
    Ok(Chain { plugins, feed, max_block, scratch: vec![0.0; max_block] })
}

impl Chain {
    pub fn names(&self) -> Vec<String> {
        self.plugins.iter().map(|p| p.label.clone()).collect()
    }

    /// In-place processing of any length, in pieces of at most max_block.
    pub fn process(&mut self, buf: &mut [f32]) {
        for piece in buf.chunks_mut(self.max_block) {
            let n = piece.len();
            for p in &mut self.plugins {
                p.process_mono(piece, &mut self.scratch[..n], self.feed);
                piece.copy_from_slice(&self.scratch[..n]);
            }
        }
    }
}
