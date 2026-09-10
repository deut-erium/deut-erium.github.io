#!/usr/bin/env python3
"""AST-only references for the two SekaiCTF Bloom challenges (AGPL-3.0).

Only inspected definitions and the literal BANNER assignment are compiled.
Original imports, top-level constructors, input loops and entrypoints are not run.
The missing mmh3 extension is replaced by the local public-domain C reference.
All reward output uses a preloaded dummy module; no flag file is opened.
"""
import ast
import ctypes
import hashlib
import json
import math
from pathlib import Path
import random
import re
import struct
import sys
import types

ROOT = Path(__file__).resolve().parents[3]
MODULUS = 2**32 - 5
REWARD = 'practice{local_dummy_reward}'
PROMOTION = b'#SEKAICTF #DEUTERIUM #DIFFECIENTWO #CRYPTO'
lib = ctypes.CDLL(str(Path(sys.argv[1]).resolve()))
lib.murmur3_reference.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_uint32]
lib.murmur3_reference.restype = ctypes.c_uint32


def mmh3_hash(data, seed=0):
    buffer = ctypes.create_string_buffer(data)
    value = lib.murmur3_reference(buffer, len(data), seed)
    return value if value < 2**31 else value - 2**32


# Known answers and the SMHasher Murmur3A verification fingerprint.
known = [(b'', 0, 0), (b'foo', 0, -156908512),
         (b'hello', 0, 613153351),
         (b'The quick brown fox jumps over the lazy dog', 0, 776992547),
         (b'', 1, 1364076727)]
for data, seed, expected in known:
    assert mmh3_hash(data, seed) == expected
key = bytes(range(256))
verification_hashes = b''.join(struct.pack('<I', mmh3_hash(key[:i], 256-i) & 0xffffffff)
                               for i in range(256))
verification = mmh3_hash(verification_hashes) & 0xffffffff
assert verification == 0xb0f57ee3, hex(verification)

# The only import reachable inside an extracted method is 'from flag import flag'.
dummy_flag = types.ModuleType('flag')
dummy_flag.flag = REWARD
sys.modules['flag'] = dummy_flag
source_records = []


def extract(relative_path, allowed, rng, output):
    path = ROOT / relative_path
    source = path.read_bytes()
    tree = ast.parse(source, filename=relative_path)
    selected = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in allowed:
            selected.append(node)
        elif (isinstance(node, ast.Assign) and len(node.targets) == 1
              and isinstance(node.targets[0], ast.Name) and node.targets[0].id == 'BANNER'):
            assert isinstance(node.value, ast.Constant) and isinstance(node.value.value, str)
            selected.append(node)
    assert {n.name for n in selected if isinstance(n, (ast.FunctionDef, ast.ClassDef))} == set(allowed)
    namespace = {'math': math, 'random': rng, 're': re,
                 'mmh3': types.SimpleNamespace(hash=mmh3_hash),
                 'print': lambda *args, **kwargs: output.append(' '.join(map(str, args)))}
    exec(compile(ast.Module(body=selected, type_ignores=[]), relative_path, 'exec'), namespace)
    source_records.append({'path': relative_path, 'sha256': hashlib.sha256(source).hexdigest(),
                           'definitions': list(allowed)})
    return namespace


entropy = bytes((i*73 + 19) % 256 for i in range(2496))
# Same 624 little-endian seed words as PythonRandom.fresh; high word is nonzero.
assert entropy[-1] != 0
rng = random.Random(int.from_bytes(entropy, 'little'))
output = []
pw = extract('assets/challenges/sekaictf-2022-diffecient/diffecient.py',
             ('randbytes', 'BloomFilter', 'PasswordDB'), rng, output)
sc = extract('assets/challenges/sekaictf-2023-diffecientwo/diffecientwo.py',
             ('BloomFilter', 'SocialCache'), None, output)


def state(obj):
    return {'count': obj.num_passwords(), 'memory': obj.memory_consumption(),
            'security': finite(obj.security())}


def finite(value):
    return value if math.isfinite(value) else 'Infinity'


def call(obj, method, data=None):
    output.clear()
    result = getattr(obj, method)(data) if data is not None else getattr(obj, method)()
    return {'method': method, 'hex': None if data is None else data.hex(),
            'result': result, 'output': list(output), 'state': state(obj)}


vectors = [{'hex': data.hex(), 'seed': seed, 'signed': expected,
            'position': expected % MODULUS} for data, seed, expected in known]
vrng = random.Random(0xb1002023)
for length in [*range(18), 31, 32, 33, 38, 41, 42, 43, 63, 64, 65, 255, 256, 257, 1024]:
    data = bytes(vrng.randrange(256) for _ in range(length))
    for seed in [*range(64), 0x7fffffff, 0x80000000, 0xffffffff]:
        value = mmh3_hash(data, seed)
        vectors.append({'hex': data.hex(), 'seed': seed, 'signed': value,
                        'position': value % MODULUS})

# Full production database setup. Save all keys only in this deterministic fixture.
saved_keys = []
original_randbytes = pw['randbytes']


def record_randbytes(n):
    value = original_randbytes(n)
    saved_keys.append(value)
    return value


pw['randbytes'] = record_randbytes
output.clear()
db = pw['PasswordDB'](MODULUS, 47, 768)
setup_output = list(output)
setup_state = state(db)
digests = sorted(db._BloomFilter__digests)
digest_sha256 = hashlib.sha256(b''.join(struct.pack('<I', d) for d in digests)).hexdigest()
output.clear()
admin_key = next(key for key in saved_keys if db.check_admin(key))
output.clear()
valid_added = b'aA0!' + b'_'*28
invalid_absent = b'aA0!' + b'z'*28
password_actions = [call(db, 'query_db', b''), call(db, 'query_db', saved_keys[0]),
                    call(db, 'query_db', invalid_absent),
                    call(db, 'check_admin', admin_key),
                    call(db, 'add_sample', valid_added),
                    call(db, 'query_db', valid_added),
                    call(db, 'check_admin', bytes(valid_added)),
                    call(db, 'add_sample', b''), call(db, 'check_admin', b''),
                    call(db, 'check_admin', invalid_absent)]

# Isolated byte-regex controls: membership always succeeds; no setup reduction
# affects the full production-dimension test above.
regex_db = object.__new__(pw['PasswordDB'])
regex_db.added_keys = {valid_added}
regex_db.check = lambda key: True
regex_inputs = [b'', b'\n', b'aA0!' + b'x'*27, b'aA0!' + b'x'*28,
                b'aA0_' + b'x'*28, b'aA0_' + b'x'*28 + b'\n',
                b'aA0_' + b'x'*28 + b'\n!', b'aA_' + b'x'*29 + b'\n0!',
                b'A0!' + b'x'*29 + b'\na', b'a0!' + b'x'*29 + b'\nA',
                b'_'*32 + b'\naA0!', b'aA0!'+b'x'*100000, valid_added]
for byte in range(256):
    for prefix in [b'A0!' + b'_'*29, b'a0!' + b'_'*29,
                   b'aA!' + b'_'*29, b'aA0' + b'_'*29]:
        regex_inputs.append(prefix + bytes([byte]))
    for position in [0, 31, 32]:
        value = bytearray(b'aA0!' + b'_'*29)
        value[position] = byte
        regex_inputs.append(bytes(value))
regex_vectors = []
for value in regex_inputs:
    output.clear()
    result = regex_db.check_admin(value)
    regex_vectors.append({'hex': value.hex(), 'added': value in regex_db.added_keys,
                          'error': output[0] if output else None, 'result': result})

# Security formula controls set only the insertion counter. Include every count
# in the actual setup and boundaries beyond it, for both production k values.
security_vectors = []
for hashes in [47, 64]:
    bf = pw['BloomFilter'](MODULUS, hashes)
    for count in [*range(len(saved_keys)+2), 10000, 2**20, 2**32]:
        bf._BloomFilter__i = count
        security_vectors.append({'hashes': hashes, 'count': count, 'value': finite(bf.security())})

# Actual SocialCache dimensions; a zero-byte post still consumes a slot.
cache = sc['SocialCache'](MODULUS, 64, 32, 22)
social_actions = [call(cache, 'find_post', b''), call(cache, 'grant_free_api'),
                  call(cache, 'add_post', b'X'*33), call(cache, 'add_post', PROMOTION),
                  call(cache, 'add_post', b''), call(cache, 'find_post', b'')]
for i in range(21):
    social_actions.append(call(cache, 'add_post', bytes([i])*32))
social_actions += [call(cache, 'add_post', b'last'), call(cache, 'add_post', b'x'*33),
                   call(cache, 'find_post', bytes([20])*32), call(cache, 'find_post', PROMOTION),
                   call(cache, 'grant_free_api')]
# Success-predicate control only: bypass add_post's length check, not a puzzle solve.
cache._add(PROMOTION)
social_success_control = call(cache, 'grant_free_api')

# Empty and duplicate insertion behavior, with original production dimensions.
bloom_vectors = []
for hashes in [47, 64]:
    bf = pw['BloomFilter'](MODULUS, hashes)
    operations = []
    for data in [b'', b'', bytes(range(32)), bytes(range(256)), b'\0', b'\xff'*33]:
        before = bf.check(data)
        bf._add(data)
        operations.append({'hex': data.hex(), 'before': before,
                           'after': bf.check(bytes(data)), 'state': state(bf)})
    bloom_vectors.append({'hashes': hashes, 'operations': operations})

print(json.dumps({'sources': source_records, 'native_verification': hex(verification),
                  'hash_vectors': vectors, 'regex_vectors': regex_vectors,
                  'security_vectors': security_vectors, 'bloom_vectors': bloom_vectors,
                  'password': {'entropy_hex': entropy.hex(), 'setup': setup_output,
                               'state': setup_state, 'first_key_hex': saved_keys[0].hex(),
                               'admin_key_hex': admin_key.hex(), 'all_keys_hex': [k.hex() for k in saved_keys],
                               'digest_sha256': digest_sha256, 'actions': password_actions},
                  'social': {'actions': social_actions, 'success_control': social_success_control},
                  'banners': {'diffecient': pw['BANNER'], 'diffecientwo': sc['BANNER']}}, indent=2))
