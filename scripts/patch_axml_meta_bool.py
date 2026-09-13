from __future__ import annotations

import argparse
import struct
from pathlib import Path


RES_STRING_POOL_TYPE = 0x0001
RES_XML_START_ELEMENT_TYPE = 0x0102
TYPE_STRING = 0x03
TYPE_INT_BOOLEAN = 0x12


def read_u16(data: bytearray, offset: int) -> int:
    return struct.unpack_from("<H", data, offset)[0]


def read_u32(data: bytearray, offset: int) -> int:
    return struct.unpack_from("<I", data, offset)[0]


def write_u32(data: bytearray, offset: int, value: int) -> None:
    struct.pack_into("<I", data, offset, value)


def decode_length8(data: bytearray, offset: int) -> tuple[int, int]:
    first = data[offset]
    if first & 0x80:
        return ((first & 0x7F) << 8) | data[offset + 1], 2
    return first, 1


def decode_length16(data: bytearray, offset: int) -> tuple[int, int]:
    first = read_u16(data, offset)
    if first & 0x8000:
        return ((first & 0x7FFF) << 16) | read_u16(data, offset + 2), 4
    return first, 2


def read_string_pool(data: bytearray, offset: int) -> list[str]:
    header_size = read_u16(data, offset + 2)
    chunk_size = read_u32(data, offset + 4)
    string_count = read_u32(data, offset + 8)
    flags = read_u32(data, offset + 28)
    strings_start = read_u32(data, offset + 20)
    is_utf8 = bool(flags & 0x00000100)
    offsets_base = offset + header_size
    strings_base = offset + strings_start
    result: list[str] = []
    for index in range(string_count):
        string_offset = strings_base + read_u32(data, offsets_base + index * 4)
        if is_utf8:
            _, consumed = decode_length8(data, string_offset)
            byte_len, consumed_2 = decode_length8(data, string_offset + consumed)
            start = string_offset + consumed + consumed_2
            result.append(bytes(data[start:start + byte_len]).decode("utf-8", errors="replace"))
        else:
            char_len, consumed = decode_length16(data, string_offset)
            start = string_offset + consumed
            result.append(bytes(data[start:start + char_len * 2]).decode("utf-16le", errors="replace"))
    # Keep chunk_size referenced so malformed pools are easier to diagnose in a debugger.
    _ = chunk_size
    return result


def patch_meta_bool(data: bytearray, target_name: str, bool_value: bool) -> int:
    if read_u16(data, 0) != 0x0003:
        raise ValueError("Input is not a binary Android XML file")

    cursor = 8
    strings: list[str] | None = None
    while cursor < len(data):
        chunk_type = read_u16(data, cursor)
        chunk_size = read_u32(data, cursor + 4)
        if chunk_size <= 0:
            raise ValueError(f"Invalid chunk size at {cursor}")
        if chunk_type == RES_STRING_POOL_TYPE:
            strings = read_string_pool(data, cursor)
            break
        cursor += chunk_size
    if strings is None:
        raise ValueError("No string pool found")

    patched = 0
    cursor = 8
    while cursor < len(data):
        chunk_type = read_u16(data, cursor)
        chunk_size = read_u32(data, cursor + 4)
        if chunk_size <= 0:
            break
        if chunk_type == RES_XML_START_ELEMENT_TYPE:
            element_name_idx = read_u32(data, cursor + 20)
            element_name = strings[element_name_idx] if element_name_idx != 0xFFFFFFFF else ""
            if element_name == "meta-data":
                attr_start = read_u16(data, cursor + 24)
                attr_size = read_u16(data, cursor + 26)
                attr_count = read_u16(data, cursor + 28)
                attrs_offset = cursor + 16 + attr_start
                matched = False
                value_data_offset: int | None = None
                value_type_offset: int | None = None
                for attr_index in range(attr_count):
                    attr_offset = attrs_offset + attr_index * attr_size
                    attr_name_idx = read_u32(data, attr_offset + 4)
                    raw_value_idx = read_u32(data, attr_offset + 8)
                    data_type = data[attr_offset + 15]
                    data_value = read_u32(data, attr_offset + 16)
                    attr_name = strings[attr_name_idx] if attr_name_idx != 0xFFFFFFFF else ""
                    raw_value = strings[raw_value_idx] if raw_value_idx != 0xFFFFFFFF else None
                    typed_string = strings[data_value] if data_type == TYPE_STRING and data_value != 0xFFFFFFFF else None
                    if attr_name == "name" and (raw_value == target_name or typed_string == target_name):
                        matched = True
                    if attr_name == "value":
                        value_type_offset = attr_offset + 15
                        value_data_offset = attr_offset + 16
                if matched and value_data_offset is not None and value_type_offset is not None:
                    data[value_type_offset] = TYPE_INT_BOOLEAN
                    write_u32(data, value_data_offset, 0xFFFFFFFF if bool_value else 0)
                    patched += 1
        cursor += chunk_size
    return patched


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--name", action="append", required=True)
    parser.add_argument("--value", choices=["true", "false"], required=True)
    args = parser.parse_args()

    data = bytearray(Path(args.input).read_bytes())
    total = 0
    for name in args.name:
        total += patch_meta_bool(data, name, args.value == "true")
    if total == 0:
        raise SystemExit("No matching meta-data value was patched")
    Path(args.output).write_bytes(data)
    print(f"patched={total}")


if __name__ == "__main__":
    main()
