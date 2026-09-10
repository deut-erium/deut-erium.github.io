/* MurmurHash3 was written by Austin Appleby, and is placed in the public
 * domain. The author hereby disclaims copyright to this source code.
 *
 * Local transcription of the canonical MurmurHash3_x86_32 reference.
 * Explicit little-endian loads replace its host-endian getblock32 helper.
 * No network acquisition or mmh3 package is used.
 */
#include <stdint.h>
#include <stddef.h>

static uint32_t rotl32(uint32_t x, unsigned r) {
    return (x << r) | (x >> (32 - r));
}
static uint32_t getblock32(const uint8_t *p) {
    return (uint32_t)p[0] | (uint32_t)p[1] << 8 |
           (uint32_t)p[2] << 16 | (uint32_t)p[3] << 24;
}
static uint32_t fmix32(uint32_t h) {
    h ^= h >> 16;
    h *= 0x85ebca6b;
    h ^= h >> 13;
    h *= 0xc2b2ae35;
    h ^= h >> 16;
    return h;
}
uint32_t murmur3_reference(const uint8_t *data, size_t len, uint32_t seed) {
    const size_t nblocks = len / 4;
    uint32_t h1 = seed;
    const uint32_t c1 = 0xcc9e2d51;
    const uint32_t c2 = 0x1b873593;
    for (size_t i = 0; i < nblocks; i++) {
        uint32_t k1 = getblock32(data + 4 * i);
        k1 *= c1;
        k1 = rotl32(k1, 15);
        k1 *= c2;
        h1 ^= k1;
        h1 = rotl32(h1, 13);
        h1 = h1 * 5 + 0xe6546b64;
    }
    const uint8_t *tail = data + nblocks * 4;
    uint32_t k1 = 0;
    switch (len & 3) {
    case 3: k1 ^= (uint32_t)tail[2] << 16; /* fall through */
    case 2: k1 ^= (uint32_t)tail[1] << 8;  /* fall through */
    case 1: k1 ^= tail[0];
        k1 *= c1;
        k1 = rotl32(k1, 15);
        k1 *= c2;
        h1 ^= k1;
    }
    h1 ^= (uint32_t)len;
    return fmix32(h1);
}
