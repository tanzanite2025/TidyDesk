const RANK_ALPHABET: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const MIN_DIGIT: u8 = RANK_ALPHABET[0];
const MAX_DIGIT: u8 = RANK_ALPHABET[RANK_ALPHABET.len() - 1];
const MID_DIGIT: u8 = RANK_ALPHABET[RANK_ALPHABET.len() / 2]; // 'V'

fn digit_index(byte: u8) -> Option<usize> {
    RANK_ALPHABET.iter().position(|ch| *ch == byte)
}

fn clean_rank(value: Option<&str>) -> Option<Vec<u8>> {
    let raw = value?.trim();
    if raw.is_empty() {
        return None;
    }
    let bytes = raw.as_bytes();
    if bytes.iter().all(|b| digit_index(*b).is_some()) {
        Some(bytes.to_vec())
    } else {
        None
    }
}

/// Generate evenly spaced initial lexicographical rank strings for sequential card indices.
pub fn initial_rank(index: usize) -> String {
    let base = RANK_ALPHABET.len();
    let step = (index + 1).saturating_mul(16);
    let mut digits = Vec::new();
    let mut value = step;
    for _ in 0..4 {
        digits.push(RANK_ALPHABET[value % base]);
        value /= base;
    }
    digits.reverse();
    String::from_utf8(digits).unwrap_or_else(|_| "000G".to_string())
}

/// Compute a strictly ordered fractional rank string between optional `prev` and `next` bounds.
pub fn rank_between(prev: Option<&str>, next: Option<&str>) -> String {
    let prev_bytes = clean_rank(prev);
    let next_bytes = clean_rank(next);

    match (prev_bytes.as_deref(), next_bytes.as_deref()) {
        (None, None) => initial_rank(0),
        (None, Some(upper)) => rank_before(upper),
        (Some(lower), None) => rank_after(lower),
        (Some(lower), Some(upper)) => {
            if lower >= upper {
                return rank_after(lower);
            }
            midpoint(lower, upper)
        }
    }
}

fn rank_before(upper: &[u8]) -> String {
    for i in 0..upper.len() {
        let idx = digit_index(upper[i]).unwrap_or(0);
        if idx > 1 {
            let mut out = upper[..i].to_vec();
            out.push(RANK_ALPHABET[idx / 2]);
            return String::from_utf8(out).unwrap_or_else(|_| "0V".to_string());
        }
        if idx == 1 {
            let mut out = upper[..i].to_vec();
            out.push(MIN_DIGIT);
            out.push(MID_DIGIT);
            return String::from_utf8(out).unwrap_or_else(|_| "0V".to_string());
        }
    }
    let mut out = upper.to_vec();
    out.push(MID_DIGIT);
    String::from_utf8(out).unwrap_or_else(|_| "0V".to_string())
}

fn rank_after(lower: &[u8]) -> String {
    for i in (0..lower.len()).rev() {
        let idx = digit_index(lower[i]).unwrap_or(RANK_ALPHABET.len() - 1);
        if idx + 1 < RANK_ALPHABET.len() {
            let next_idx = (idx + RANK_ALPHABET.len()) / 2;
            let bump = if next_idx == idx { idx + 1 } else { next_idx };
            let mut out = lower[..=i].to_vec();
            out[i] = RANK_ALPHABET[bump];
            return String::from_utf8(out).unwrap_or_else(|_| "z".to_string());
        }
    }
    let mut out = lower.to_vec();
    out.push(MID_DIGIT);
    String::from_utf8(out).unwrap_or_else(|_| "zV".to_string())
}

fn midpoint(lower: &[u8], upper: &[u8]) -> String {
    let max_len = lower.len().max(upper.len());
    let mut result = Vec::with_capacity(max_len + 1);

    for i in 0..=max_len {
        let low_idx = lower.get(i).copied().and_then(digit_index).unwrap_or(0);
        let high_idx = upper
            .get(i)
            .copied()
            .and_then(digit_index)
            .unwrap_or(RANK_ALPHABET.len());

        if low_idx == high_idx {
            result.push(RANK_ALPHABET[low_idx]);
            continue;
        }

        if high_idx.saturating_sub(low_idx) > 1 {
            let mid_idx = (low_idx + high_idx) / 2;
            result.push(RANK_ALPHABET[mid_idx]);
            return String::from_utf8(result).unwrap_or_else(|_| "V".to_string());
        }

        // Adjacent digits: keep low_idx and extend with suffix > low's tail
        result.push(RANK_ALPHABET[low_idx]);
        let mut suffix_start = i + 1;
        while suffix_start < lower.len() {
            let tail_idx = digit_index(lower[suffix_start]).unwrap_or(0);
            if tail_idx + 1 < RANK_ALPHABET.len() {
                let bump = (tail_idx + RANK_ALPHABET.len()) / 2;
                let chosen = if bump == tail_idx { tail_idx + 1 } else { bump };
                result.push(RANK_ALPHABET[chosen]);
                return String::from_utf8(result).unwrap_or_else(|_| "V".to_string());
            }
            result.push(MAX_DIGIT);
            suffix_start += 1;
        }
        result.push(MID_DIGIT);
        return String::from_utf8(result).unwrap_or_else(|_| "V".to_string());
    }

    let mut fallback = lower.to_vec();
    fallback.push(MID_DIGIT);
    String::from_utf8(fallback).unwrap_or_else(|_| "V".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initial_ranks_are_strictly_increasing() {
        let ranks: Vec<String> = (0..10).map(initial_rank).collect();
        for pair in ranks.windows(2) {
            assert!(pair[0] < pair[1], "{} should be < {}", pair[0], pair[1]);
        }
    }

    #[test]
    fn rank_between_maintains_strict_order_across_repeated_bisections() {
        let first = initial_rank(0);
        let second = initial_rank(1);
        let mid = rank_between(Some(&first), Some(&second));
        assert!(first < mid && mid < second);

        let mut left = "a".to_string();
        let right = "b".to_string();
        for _ in 0..8 {
            let next_mid = rank_between(Some(&left), Some(&right));
            assert!(
                left < next_mid && next_mid < right,
                "failed order: {left} < {next_mid} < {right}"
            );
            left = next_mid;
        }
    }

    #[test]
    fn rank_between_handles_open_head_and_tail_bounds() {
        let first = initial_rank(0);
        let head = rank_between(None, Some(&first));
        let tail = rank_between(Some(&first), None);
        assert!(head < first);
        assert!(first < tail);

        let mut cur = "0001".to_string();
        for _ in 0..10 {
            let next_head = rank_between(None, Some(&cur));
            assert!(next_head < cur, "{next_head} should be < {cur}");
            cur = next_head;
        }
    }
}
