"""Pinned public sources for the optional native TCP practice service."""
import hashlib
import io
from pathlib import Path
import tarfile
import zipfile

ROOT = Path(__file__).resolve().parents[2]
REWARD = "practice{local_dummy_reward}"
# slug: (asset path, archive digest, exact member name, member digest)
SOURCES = {
    'desfunctional': ('google-ctf-2024-desfunctional/chall.py', 'f8fd36aa22a93dfab66e2961f0c5ef3ad0a8ac610e71f52306a3b8f477e92799', None, None),
    'idea': ('google-ctf-2024-idea/chall.py', '5fb44f432cffbf19fec715a617be1c373f99d2f3e4a602ebab7c3668b7e040c0', None, None),
    'diffecient': ('sekaictf-2022-diffecient/diffecient.py', 'bf4668f888f33cea4280e878300f3f738a8e46ae7a9ed25ba507844f65d3b245', None, None),
    'diffecientwo': ('sekaictf-2023-diffecientwo/diffecientwo.py', 'e91a6409ae1500161ce4ed455589cbe8e94aa1c803538342984c504367fdbfd3', None, None),
    'randsubware': ('sekaictf-2023-randsubware/chall.py', 'e8f1adc85143e5213f2992d735383862482da62d1f9356b87fabb63909e50c4f', None, None),
    'law-and-order-corrected': ('sekaictf-2025-law-and-order/corrected-chall.py', '2bdeeeaf9326a11a26e56bb6a35ffb25907385d649c426492e2e6645ccf19b37', None, None),
    'law-and-order-released': ('sekaictf-2025-law-and-order/released-chall.py', '76f203c72a553a10ee134c0b03094e9b0ab6a709d0f4c0bc2ec55ea25fcd13f2', None, None),
    'b00tleg': ('zh3r0-2021-b00tleg/organizer-practice.py', '21ebf905b9af68e8215883456a7f4a344a5577859ea4b6a526223a60a6ef7208', None, None),
    'chaos': ('zh3r0-2021-chaos/challenge.py', 'b58529c8f5aa8d50bd38ab3ca595fcb65bf8ca00b4a2c235082811669fa95b8e', None, None),
    'real-mersenne': ('zh3r0-2021-real-mersenne/challenge.py', 'ca3c4c28c6271359f4a7838f7f7ae5fd06e534e30920fc9f21aff1223d27582c', None, None),
    'cheater-mind': ('zh3r0-2021-cheater-mind/cheater-mind-76c6bf15e3b565583a26f5936b9faef6a7ee2c46.tar.gz', '4d55bd0ff2ad38ffb4e977545e469482412bf37a2fb9296799ecff3a694666df', './challenge.py', '6ff910292c28639631517f4ae6c775cfb827c6f51e2542034fe41f7694f65bb1'),
    'blokechain': ('cyber-apocalypse-2023-blokechain/crypto_blokechain.zip', 'b26190c3145eeadfb318487d410986baee6758d12c414ad297044626a9f68455', 'crypto_blokechain/server.py', 'c4974c9b2a81981b399f1e1217af58dfbe4461c89f02d92c00fe51d15edce363'),
}
RUNTIMES = tuple(sorted((set(SOURCES) - {'law-and-order-corrected', 'law-and-order-released'}) | {'law-and-order'}))


def load_source(runtime, variant=None):
    if runtime not in RUNTIMES:
        raise ValueError('unknown challenge')
    if runtime == 'law-and-order':
        variant = variant or 'corrected'
        if variant not in ('corrected', 'released'):
            raise ValueError('Law and Order variant must be corrected or released')
        key = runtime + '-' + variant
    else:
        if variant is not None:
            raise ValueError('--variant applies only to Law and Order')
        key = runtime
    name, digest, member, member_digest = SOURCES[key]
    path = ROOT / 'assets/challenges' / name
    if path.is_symlink() or path.stat().st_size > 256 * 1024:
        raise ValueError('invalid source file')
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != digest:
        raise ValueError('challenge source digest mismatch: ' + name)
    if member:
        if name.endswith('.zip'):
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                info = archive.getinfo(member)
                if info.file_size > 256 * 1024 or info.is_dir():
                    raise ValueError('invalid ZIP member')
                raw = archive.read(info)
        else:
            with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as archive:
                info = archive.getmember(member)
                if not info.isfile() or info.size > 256 * 1024:
                    raise ValueError('invalid TAR member')
                raw = archive.extractfile(info).read()
        if hashlib.sha256(raw).hexdigest() != member_digest:
            raise ValueError('archive member digest mismatch')
    # No archive filesystem extraction. Preserve every byte except this public
    # placeholder in the per-session copy, never the mirrored download.
    if runtime == 'blokechain':
        before = b'print("FLAG")'
        if raw.count(before) != 1:
            raise ValueError('unexpected Blokechain reward statement')
        raw = raw.replace(before, ('print(' + repr(REWARD) + ')').encode())
    compile(raw, 'challenge.py', 'exec')
    return raw


def check_dependencies(runtime):
    # Import checks fail before opening a listener; no puzzle code runs here.
    if runtime in ('desfunctional', 'b00tleg'):
        try:
            from Crypto.Cipher import DES3  # noqa: F401
            from Crypto.Util.number import getPrime  # noqa: F401
        except ImportError as exc:
            raise ValueError('this challenge needs PyCryptodome; see script/challenge_practice/requirements.txt') from exc
    if runtime == 'law-and-order':
        try:
            from py_ecc.secp256k1.secp256k1 import add, multiply  # noqa: F401
        except ImportError as exc:
            raise ValueError('Law and Order needs py-ecc; see script/challenge_practice/requirements.txt') from exc
