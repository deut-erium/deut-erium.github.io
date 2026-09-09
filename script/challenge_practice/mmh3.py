"""Small local substitute for mmh3.hash(bytes, seed), x86_32."""
_MASK = 0xffffffff


def _rotl(x, n):
    return ((x << n) | (x >> (32 - n))) & _MASK


def hash(key, seed=0, signed=True):
    if not isinstance(key, (bytes, bytearray, memoryview)):
        raise TypeError("argument 1 must be bytes")
    data = bytes(key)
    h = int(seed) & _MASK
    end = len(data) - len(data) % 4
    for offset in range(0, end, 4):
        k = int.from_bytes(data[offset:offset + 4], "little")
        k = (k * 0xcc9e2d51) & _MASK
        k = (_rotl(k, 15) * 0x1b873593) & _MASK
        h ^= k
        h = ((_rotl(h, 13) * 5) + 0xe6546b64) & _MASK
    tail = data[end:]
    k = 0
    if len(tail) == 3:
        k ^= tail[2] << 16
    if len(tail) >= 2:
        k ^= tail[1] << 8
    if tail:
        k ^= tail[0]
        k = (k * 0xcc9e2d51) & _MASK
        k = (_rotl(k, 15) * 0x1b873593) & _MASK
        h ^= k
    h ^= len(data)
    h ^= h >> 16
    h = (h * 0x85ebca6b) & _MASK
    h ^= h >> 13
    h = (h * 0xc2b2ae35) & _MASK
    h ^= h >> 16
    return h if not signed or h < 0x80000000 else h - (1 << 32)
