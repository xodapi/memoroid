#![no_std]

use core::panic::PanicInfo;

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! { loop {} }

fn separator(byte: u8) -> bool {
    byte == b' '
}

fn contains_token(source: &[u8], token: &[u8]) -> bool {
    let mut start = 0;
    while start < source.len() {
        while start < source.len() && separator(source[start]) { start += 1; }
        let mut end = start;
        while end < source.len() && !separator(source[end]) { end += 1; }
        if end - start == token.len() && source[start..end] == *token {
            return true;
        }
        start = end;
    }
    false
}

#[no_mangle]
pub extern "C" fn count_words(ptr: *const u8, len: usize) -> u32 {
    let bytes = unsafe { core::slice::from_raw_parts(ptr, len) };
    let mut count = 0u32;
    let mut in_word = false;
    for byte in bytes {
        let whitespace = matches!(*byte, b' ' | b'\n' | b'\r' | b'\t');
        if whitespace {
            in_word = false;
        } else if !in_word {
            count = count.saturating_add(1);
            in_word = true;
        }
    }
    count
}

#[no_mangle]
pub extern "C" fn contains_all_tokens(
    source_ptr: *const u8,
    source_len: usize,
    query_ptr: *const u8,
    query_len: usize,
) -> u32 {
    let source = unsafe { core::slice::from_raw_parts(source_ptr, source_len) };
    let query = unsafe { core::slice::from_raw_parts(query_ptr, query_len) };
    let mut start = 0;
    while start < query.len() {
        while start < query.len() && separator(query[start]) { start += 1; }
        let mut end = start;
        while end < query.len() && !separator(query[end]) { end += 1; }
        if end > start && !contains_token(source, &query[start..end]) {
            return 0;
        }
        start = end;
    }
    1
}
