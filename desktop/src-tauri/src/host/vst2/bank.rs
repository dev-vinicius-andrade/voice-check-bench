//! JUCE `.fxb` bank codec: what Wave Link stores (base64) as a VST2 plugin's `ParameterState`.
//! JUCE `VSTPluginInstance::saveToFXBFile(isFXB = true)` layout, all big-endian:
//!   fxSet header (156 bytes): `CcnK`, byteSize 0, fxMagic (`FxBk` | `FBCh`), version 1, fxID, fxVersion,
//!     numPrograms, currentProgram 0, future[128] zero.
//!   `FxBk`: numPrograms × fxProgram (56-byte header: `CcnK`, 0, `FxCk`, 1, fxID, fxVersion, numParams,
//!     prgName[28]) + numParams floats from getParameter.
//!   `FBCh`: i32 chunkSize, then the `effGetChunk(bank)` bytes.

use crate::host::HostResult;

pub const SET_HEADER: usize = 156;
pub const PROG_HEADER: usize = 56;

#[derive(Debug, Clone, PartialEq)]
pub struct Program {
    pub name: [u8; 28],
    pub params: Vec<f32>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Body {
    Bank(Vec<Program>),
    Chunk(Vec<u8>),
}

#[derive(Debug, Clone, PartialEq)]
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
    i32::from_be_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]])
}

pub fn parse(b: &[u8]) -> HostResult<Fxb> {
    if b.len() < SET_HEADER + 4 || &b[0..4] != b"CcnK" {
        return Err("not a CcnK bank".into());
    }
    let num_programs = be_i32(b, 24);
    let body = match &b[8..12] {
        b"FBCh" => {
            let size = usize::try_from(be_i32(b, SET_HEADER)).map_err(|_| "negative chunk size")?;
            if SET_HEADER + 4 + size > b.len() {
                return Err(format!("chunk size {size} past end").into());
            }
            Body::Chunk(b[SET_HEADER + 4..SET_HEADER + 4 + size].to_vec())
        }
        b"FxBk" => {
            let mut progs = vec![];
            let mut o = SET_HEADER;
            for _ in 0..num_programs.max(1) {
                if o + PROG_HEADER > b.len()
                    || &b[o..o + 4] != b"CcnK"
                    || &b[o + 8..o + 12] != b"FxCk"
                {
                    return Err(format!("bad fxProgram at {o}").into());
                }
                let n = usize::try_from(be_i32(b, o + 24)).map_err(|_| "negative numParams")?;
                if o + PROG_HEADER + 4 * n > b.len() {
                    return Err(format!("fxProgram at {o} runs past end").into());
                }
                let mut name = [0u8; 28];
                name.copy_from_slice(&b[o + 28..o + 56]);
                let params = (0..n)
                    .map(|k| {
                        let p = o + PROG_HEADER + 4 * k;
                        f32::from_be_bytes([b[p], b[p + 1], b[p + 2], b[p + 3]])
                    })
                    .collect();
                progs.push(Program { name, params });
                o += PROG_HEADER + 4 * n;
            }
            Body::Bank(progs)
        }
        m => return Err(format!("unsupported fxMagic {:?}", String::from_utf8_lossy(m)).into()),
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

/// JUCE-style bank bytes (byteSize 0, version 1, currentProgram and future zero, as JUCE writes them).
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

/// A 28-byte program name field from text (truncated to 27 bytes, NUL padded).
pub fn program_name(s: &str) -> [u8; 28] {
    let mut name = [0u8; 28];
    let n = s.len().min(27);
    name[..n].copy_from_slice(&s.as_bytes()[..n]);
    name
}

#[cfg(test)]
mod tests {
    use super::*;

    const FX_ID: i32 = i32::from_be_bytes(*b"tst1");

    #[test]
    fn param_bank_layout_and_round_trip() {
        let params: Vec<f32> = (0..19).map(|k| k as f32 * 0.25).collect();
        let body = Body::Bank(vec![Program {
            name: program_name("Default"),
            params: params.clone(),
        }]);
        let bytes = build(FX_ID, 1100, 1, &body);
        assert_eq!(bytes.len(), SET_HEADER + PROG_HEADER + 19 * 4);
        assert_eq!(&bytes[0..4], b"CcnK");
        assert_eq!(&bytes[8..12], b"FxBk");
        assert_eq!(be_i32(&bytes, 4), 0, "JUCE writes byteSize 0");
        assert_eq!(be_i32(&bytes, 12), 1);
        assert_eq!(be_i32(&bytes, 20), 1100);
        assert_eq!(&bytes[SET_HEADER + 8..SET_HEADER + 12], b"FxCk");
        // param 11 sits at 156 + 56 + 44 = 256..260, big-endian
        assert_eq!(&bytes[256..260], &2.75f32.to_be_bytes());
        let f = parse(&bytes).unwrap();
        assert_eq!(
            (f.fx_id, f.fx_version, f.num_programs, f.current_program),
            (FX_ID, 1100, 1, 0)
        );
        assert_eq!(f.body, body);
        assert_eq!(build(f.fx_id, f.fx_version, f.num_programs, &f.body), bytes);
    }

    #[test]
    fn chunk_bank_layout_and_round_trip() {
        let chunk: Vec<u8> = (0..=255u8).cycle().take(329).collect();
        let body = Body::Chunk(chunk.clone());
        let bytes = build(FX_ID, 1100, 1, &body);
        assert_eq!(bytes.len(), SET_HEADER + 4 + chunk.len());
        assert_eq!(&bytes[8..12], b"FBCh");
        assert_eq!(be_i32(&bytes, SET_HEADER), 329);
        let f = parse(&bytes).unwrap();
        assert_eq!(f.body, Body::Chunk(chunk));
        assert_eq!(build(f.fx_id, f.fx_version, f.num_programs, &f.body), bytes);
    }

    #[test]
    fn rejects_bad_input() {
        assert!(parse(b"nope").is_err());
        let mut bytes = build(FX_ID, 1, 1, &Body::Chunk(vec![1, 2, 3]));
        bytes.truncate(bytes.len() - 1);
        assert!(parse(&bytes).is_err(), "chunk past end");
        let mut bytes = build(FX_ID, 1, 1, &Body::Chunk(vec![]));
        bytes[8..12].copy_from_slice(b"FPCh");
        assert!(parse(&bytes).is_err(), "unknown magic");
    }
}
