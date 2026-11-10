// .fxb bank as JUCE's VSTPluginInstance::saveToFXBFile(isFXB = true) writes it (which is what Wave Link stores):
//   FxBk: fxSet header (156 bytes: CcnK, byteSize 0, FxBk, version 1, fxID, fxVersion, numPrograms, future[128])
//         + numPrograms x fxProgram (56-byte header: CcnK, 0, FxCk, 1, fxID, fxVersion, numParams, prgName[28])
//         + numParams big-endian floats from getParameter().
//   FBCh: same 156-byte header with FBCh, then big-endian int32 chunkSize, then the effGetChunk(bank) bytes.
use anyhow::{Result, bail};

pub const SET_HEADER: usize = 156;
pub const PROG_HEADER: usize = 56;

#[derive(Debug, Clone)]
pub struct Program {
    pub name: [u8; 28],
    pub params: Vec<f32>,
}

#[derive(Debug, Clone)]
pub enum Body {
    Bank(Vec<Program>),
    Chunk(Vec<u8>),
}

#[derive(Debug, Clone)]
pub struct Fxb {
    pub byte_size: i32,
    pub version: i32,
    pub fx_id: i32,
    pub fx_version: i32,
    pub num_programs: i32,
    pub current_program: i32,
    pub body: Body,
}

fn be_i32(b: &[u8], o: usize) -> i32 {
    i32::from_be_bytes(b[o..o + 4].try_into().unwrap())
}

pub fn parse(b: &[u8]) -> Result<Fxb> {
    if b.len() < SET_HEADER + 4 || &b[0..4] != b"CcnK" {
        bail!("not a CcnK blob");
    }
    let magic = &b[8..12];
    let num_programs = be_i32(b, 24);
    let body = match magic {
        b"FBCh" => {
            let size = be_i32(b, SET_HEADER) as usize;
            if SET_HEADER + 4 + size > b.len() {
                bail!("chunk size {size} past end");
            }
            Body::Chunk(b[SET_HEADER + 4..SET_HEADER + 4 + size].to_vec())
        }
        b"FxBk" => {
            let mut progs = vec![];
            let mut o = SET_HEADER;
            for _ in 0..num_programs.max(1) {
                if o + PROG_HEADER > b.len() || &b[o..o + 4] != b"CcnK" || &b[o + 8..o + 12] != b"FxCk" {
                    bail!("bad fxProgram at {o}");
                }
                let n = be_i32(b, o + 24) as usize;
                let mut name = [0u8; 28];
                name.copy_from_slice(&b[o + 28..o + 56]);
                let params = (0..n).map(|k| f32::from_be_bytes(b[o + 56 + 4 * k..o + 60 + 4 * k].try_into().unwrap())).collect();
                progs.push(Program { name, params });
                o += PROG_HEADER + 4 * n;
            }
            Body::Bank(progs)
        }
        m => bail!("unsupported fxMagic {:?}", String::from_utf8_lossy(m)),
    };
    Ok(Fxb {
        byte_size: be_i32(b, 4),
        version: be_i32(b, 12),
        fx_id: be_i32(b, 16),
        fx_version: be_i32(b, 20),
        num_programs,
        current_program: be_i32(b, 28),
        body,
    })
}

/// JUCE-style .fxb bytes (byteSize 0, version 1, currentProgram/future zero, as JUCE writes them).
pub fn build(fx_id: i32, fx_version: i32, num_programs: i32, body: &Body) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(b"CcnK");
    out.extend_from_slice(&0i32.to_be_bytes());
    out.extend_from_slice(match body {
        Body::Bank(_) => b"FxBk",
        Body::Chunk(_) => b"FBCh",
    });
    out.extend_from_slice(&1i32.to_be_bytes());
    out.extend_from_slice(&fx_id.to_be_bytes());
    out.extend_from_slice(&fx_version.to_be_bytes());
    out.extend_from_slice(&num_programs.to_be_bytes());
    out.resize(SET_HEADER, 0);
    match body {
        Body::Chunk(c) => {
            out.extend_from_slice(&(c.len() as i32).to_be_bytes());
            out.extend_from_slice(c);
        }
        Body::Bank(progs) => {
            for p in progs {
                out.extend_from_slice(b"CcnK");
                out.extend_from_slice(&0i32.to_be_bytes());
                out.extend_from_slice(b"FxCk");
                out.extend_from_slice(&1i32.to_be_bytes());
                out.extend_from_slice(&fx_id.to_be_bytes());
                out.extend_from_slice(&fx_version.to_be_bytes());
                out.extend_from_slice(&(p.params.len() as i32).to_be_bytes());
                out.extend_from_slice(&p.name);
                for v in &p.params {
                    out.extend_from_slice(&v.to_be_bytes());
                }
            }
        }
    }
    out
}

/// Human description of the byte differences between two blobs (offset ranges + what they are).
pub fn diff(a: &[u8], b: &[u8]) -> Vec<String> {
    let mut out = vec![];
    if a.len() != b.len() {
        out.push(format!("length differs: stored {} vs host {}", a.len(), b.len()));
    }
    let n = a.len().min(b.len());
    let mut k = 0;
    while k < n {
        if a[k] != b[k] {
            let start = k;
            while k < n && a[k] != b[k] {
                k += 1;
            }
            let end = k.min(start + 32);
            out.push(format!(
                "bytes {}..{}: stored {} | host {}",
                start,
                k,
                hex(&a[start..end]),
                hex(&b[start..end])
            ));
        } else {
            k += 1;
        }
    }
    out
}

pub fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect::<Vec<_>>().join("")
}
