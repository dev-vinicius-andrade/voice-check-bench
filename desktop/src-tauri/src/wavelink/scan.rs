// Span tree of a JSON text: every value with its byte range in the original text, object keys in file order
// (duplicates kept). Used to read Settings.json and to replace single values without touching any other byte.
// Leaf strings are decoded with serde_json on their own slice, so escaping rules are serde_json's.
use super::error::{err, WlErrorCode, WlResult};

#[derive(Debug, Clone)]
pub enum Kind {
    Object(Vec<(String, Node)>),
    Array(Vec<Node>),
    String,
    Number,
    Bool(bool),
    Null,
}

/// A JSON value spanning `text[start..end]`.
#[derive(Debug, Clone)]
pub struct Node {
    pub start: usize,
    pub end: usize,
    pub kind: Kind,
}

impl Node {
    /// All values of `key` in an object, in file order (empty for non-objects).
    pub fn get_all<'a>(&'a self, key: &str) -> Vec<&'a Node> {
        match &self.kind {
            Kind::Object(entries) => entries
                .iter()
                .filter(|(k, _)| k == key)
                .map(|(_, v)| v)
                .collect(),
            _ => Vec::new(),
        }
    }

    /// The value of `key` (the last one when the key repeats, like serde_json).
    pub fn get(&self, key: &str) -> Option<&Node> {
        self.get_all(key).pop()
    }

    /// Decoded string value, None when this is not a string.
    pub fn as_str(&self, text: &str) -> Option<String> {
        match self.kind {
            Kind::String => serde_json::from_str::<String>(&text[self.start..self.end]).ok(),
            _ => None,
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self.kind {
            Kind::Bool(b) => Some(b),
            _ => None,
        }
    }

    pub fn items(&self) -> Option<&[Node]> {
        match &self.kind {
            Kind::Array(items) => Some(items),
            _ => None,
        }
    }

    pub fn entries(&self) -> Option<&[(String, Node)]> {
        match &self.kind {
            Kind::Object(entries) => Some(entries),
            _ => None,
        }
    }
}

const BOM: char = '\u{feff}';

/// Parses `text` (optional leading BOM) into a span tree. Errors with `Parse` on invalid JSON.
pub fn parse(text: &str) -> WlResult<Node> {
    let body = text.strip_prefix(BOM).unwrap_or(text);
    if let Err(e) = serde_json::from_str::<serde_json::Value>(body) {
        return err(WlErrorCode::Parse, format!("invalid JSON: {e}"));
    }
    let mut s = Scanner {
        b: text.as_bytes(),
        text,
        i: text.len() - body.len(),
    };
    let root = s.value(0)?;
    s.ws();
    if s.i != s.b.len() {
        return s.fail("trailing data");
    }
    Ok(root)
}

struct Scanner<'a> {
    b: &'a [u8],
    text: &'a str,
    i: usize,
}

impl Scanner<'_> {
    fn fail<T>(&self, what: &str) -> WlResult<T> {
        err(
            WlErrorCode::Parse,
            format!("invalid JSON at byte {}: {what}", self.i),
        )
    }

    fn ws(&mut self) {
        while self.i < self.b.len() && matches!(self.b[self.i], b' ' | b'\t' | b'\n' | b'\r') {
            self.i += 1;
        }
    }

    fn peek(&self) -> Option<u8> {
        self.b.get(self.i).copied()
    }

    /// Skips a string starting at the opening quote; returns its span (quotes included).
    fn string(&mut self) -> WlResult<(usize, usize)> {
        let start = self.i;
        self.i += 1;
        while let Some(c) = self.peek() {
            self.i += 1;
            match c {
                b'"' => return Ok((start, self.i)),
                b'\\' => self.i += 1, // the escaped byte (\uXXXX digits are plain bytes)
                _ => {}
            }
        }
        self.fail("unterminated string")
    }

    fn value(&mut self, depth: usize) -> WlResult<Node> {
        if depth > 256 {
            return self.fail("nesting too deep");
        }
        self.ws();
        let start = self.i;
        let kind = match self.peek() {
            Some(b'{') => Kind::Object(self.object(depth)?),
            Some(b'[') => Kind::Array(self.array(depth)?),
            Some(b'"') => {
                self.string()?;
                Kind::String
            }
            Some(b't') => self.word("true", Kind::Bool(true))?,
            Some(b'f') => self.word("false", Kind::Bool(false))?,
            Some(b'n') => self.word("null", Kind::Null)?,
            Some(c) if c == b'-' || c.is_ascii_digit() => {
                while self
                    .peek()
                    .is_some_and(|c| matches!(c, b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9'))
                {
                    self.i += 1;
                }
                Kind::Number
            }
            _ => return self.fail("unexpected token"),
        };
        Ok(Node {
            start,
            end: self.i,
            kind,
        })
    }

    fn word(&mut self, w: &str, kind: Kind) -> WlResult<Kind> {
        if self.b[self.i..].starts_with(w.as_bytes()) {
            self.i += w.len();
            Ok(kind)
        } else {
            self.fail("unexpected token")
        }
    }

    fn object(&mut self, depth: usize) -> WlResult<Vec<(String, Node)>> {
        self.i += 1;
        let mut entries = Vec::new();
        self.ws();
        if self.peek() == Some(b'}') {
            self.i += 1;
            return Ok(entries);
        }
        loop {
            self.ws();
            if self.peek() != Some(b'"') {
                return self.fail("expected key");
            }
            let (ks, ke) = self.string()?;
            let key = match serde_json::from_str::<String>(&self.text[ks..ke]) {
                Ok(k) => k,
                Err(_) => return self.fail("bad key"),
            };
            self.ws();
            if self.peek() != Some(b':') {
                return self.fail("expected :");
            }
            self.i += 1;
            entries.push((key, self.value(depth + 1)?));
            self.ws();
            match self.peek() {
                Some(b',') => self.i += 1,
                Some(b'}') => {
                    self.i += 1;
                    return Ok(entries);
                }
                _ => return self.fail("expected , or }"),
            }
        }
    }

    fn array(&mut self, depth: usize) -> WlResult<Vec<Node>> {
        self.i += 1;
        let mut items = Vec::new();
        self.ws();
        if self.peek() == Some(b']') {
            self.i += 1;
            return Ok(items);
        }
        loop {
            items.push(self.value(depth + 1)?);
            self.ws();
            match self.peek() {
                Some(b',') => self.i += 1,
                Some(b']') => {
                    self.i += 1;
                    return Ok(items);
                }
                _ => return self.fail("expected , or ]"),
            }
        }
    }
}
