// Fixed-capacity delay line for the audio thread: raw alignment and bypass delay compensation.
// Allocated once; `process` never allocates.
use crate::host::BLOCK;

/// A circular buffer that outputs its input `delay` samples later. The delay may change between calls (the read
/// position jumps; no crossfade). Starts silent.
pub struct DelayLine {
    buf: Vec<f32>,
    mask: usize,
    /// Index where the next input sample is written.
    write: usize,
}

impl DelayLine {
    /// A line that can delay by up to `max_delay` samples with pieces of up to [`BLOCK`] samples.
    pub fn new(max_delay: usize) -> Self {
        let cap = (max_delay + BLOCK).next_power_of_two();
        Self {
            buf: vec![0.0; cap],
            mask: cap - 1,
            write: 0,
        }
    }

    /// Largest delay `process` honours; larger requests are clamped to it.
    pub fn max_delay(&self) -> usize {
        self.buf.len() - BLOCK
    }

    /// `output[i] = input[i - delay]` across calls. `input` and `output` have the same length, at most [`BLOCK`]
    /// (longer input is processed in [`BLOCK`] pieces).
    pub fn process(&mut self, input: &[f32], output: &mut [f32], delay: usize) {
        let n = input.len().min(output.len());
        let delay = delay.min(self.max_delay());
        let mut start = 0;
        while start < n {
            let end = (start + BLOCK).min(n);
            for (k, v) in input[start..end].iter().enumerate() {
                self.buf[(self.write + k) & self.mask] = *v;
            }
            // Oldest sample still held: write + len - cap; delay <= cap - BLOCK keeps every read inside it.
            let base = self.write + self.buf.len() - delay;
            for (k, o) in output[start..end].iter_mut().enumerate() {
                *o = self.buf[(base + k) & self.mask];
            }
            self.write = (self.write + end - start) & self.mask;
            start = end;
        }
    }

    /// Back to silence.
    pub fn clear(&mut self) {
        self.buf.fill(0.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ramp(n: usize, from: usize) -> Vec<f32> {
        (from..from + n).map(|k| k as f32 + 1.0).collect()
    }

    /// Runs `signal` through the line in `piece`-sized calls at a fixed delay.
    fn run(line: &mut DelayLine, signal: &[f32], piece: usize, delay: usize) -> Vec<f32> {
        let mut out = vec![0.0; signal.len()];
        for (i, o) in signal.chunks(piece).zip(out.chunks_mut(piece)) {
            line.process(i, o, delay);
        }
        out
    }

    #[test]
    fn zero_delay_is_identity() {
        let mut d = DelayLine::new(1000);
        let x = ramp(3 * BLOCK, 0);
        assert_eq!(run(&mut d, &x, BLOCK, 0), x);
    }

    #[test]
    fn delays_exactly_across_block_boundaries() {
        for delay in [1, 7, BLOCK - 1, BLOCK, BLOCK + 1, 4096, 4096 + 480] {
            let mut d = DelayLine::new(8192);
            let x = ramp(20 * BLOCK, 0);
            let y = run(&mut d, &x, BLOCK, delay);
            assert!(
                y[..delay].iter().all(|v| *v == 0.0),
                "silent before {delay}"
            );
            assert_eq!(&y[delay..], &x[..x.len() - delay], "delay {delay}");
        }
    }

    #[test]
    fn odd_piece_sizes_match_block_pieces() {
        let x = ramp(10 * BLOCK, 0);
        let mut a = DelayLine::new(2000);
        let mut b = DelayLine::new(2000);
        assert_eq!(run(&mut a, &x, 37, 1234), run(&mut b, &x, BLOCK, 1234));
        let mut c = DelayLine::new(2000);
        let mut fresh = DelayLine::new(2000);
        assert_eq!(
            run(&mut c, &x, 3 * BLOCK, 1234),
            run(&mut fresh, &x, BLOCK, 1234),
            "pieces longer than a block are cut into blocks"
        );
    }

    #[test]
    fn clamps_to_capacity() {
        let mut d = DelayLine::new(100);
        let max = d.max_delay();
        assert!(max >= 100);
        let x = ramp(4 * max, 0);
        let y = run(&mut d, &x, BLOCK, max + 10_000);
        assert_eq!(&y[max..], &x[..x.len() - max]);
    }

    #[test]
    fn changing_the_delay_jumps_the_read_position() {
        let mut d = DelayLine::new(2000);
        let x = ramp(6 * BLOCK, 0);
        let mut y = vec![0.0; x.len()];
        for (k, (i, o)) in x.chunks(BLOCK).zip(y.chunks_mut(BLOCK)).enumerate() {
            d.process(i, o, if k < 3 { 480 } else { 960 });
        }
        // Block 3 onwards reads 960 back: sample t shows x[t - 960].
        let t = 3 * BLOCK;
        assert_eq!(y[t], x[t - 960]);
        assert_eq!(y[t - 1], x[t - 1 - 480]);
    }

    #[test]
    fn clear_silences() {
        let mut d = DelayLine::new(1000);
        let x = ramp(BLOCK, 0);
        let mut y = vec![0.0; BLOCK];
        d.process(&x, &mut y, 0);
        d.clear();
        d.process(&vec![0.0; BLOCK], &mut y, 100);
        assert!(y.iter().all(|v| *v == 0.0));
    }
}
