# Unified history import security review

Raw credential and analytics values are redacted throughout this report.

## Decision

| History | Import verdict | Reason |
| --- | --- | --- |
| Root `master` | Safe to attach | No plausible live authentication credential or private key was found. Historical CTF flags are intentional public challenge material. Google Analytics identifiers remain as privacy history. |
| WriteUps `master` | Safe to attach | Token and key hits are confined to public CTF solutions and challenge files. Google Analytics identifiers remain as privacy history. |
| CTF tutorials `master` | Do not attach as-is | Nine reachable commits retain an imported TeXt documentation configuration with a concrete Gitalk OAuth secret and LeanCloud client credentials. Use a rewritten import history. |
| Ramblings `main` | Do not attach as-is | A concrete Gitalk OAuth client ID and secret remain in 23 source commits, including the tip. Use a rewritten import history and rotate or revoke the OAuth secret. |
| Any `gh-pages` history | Omit | These branches are generated output, add large duplicate object sets, preserve tracking code, and in Ramblings duplicate the OAuth values into rendered HTML. Recover required static files in clean source commits instead. |

The local target `refs/heads/unified-publishing` is at `5bcc22b7040bf4f6d2a111637d53272f2384634a`. It is a shallow history rooted at the public root commit, so attaching the full root history would also fill in the missing ancestors. Equality checks found none of the identified CTF tutorial or Ramblings credential values in any blob currently reachable from the target branch.

## Scope and method

The source clones are the four non-shallow acquisition clones under `agent_out/merge-inventory/repos/`. Local heads and `refs/remotes/origin/*` agree at each audited tip. `git fsck --full --no-dangling` reported no missing or corrupt objects.

Every blob reachable from the named source ref was read, not only the current tree. The review covered common provider token formats, PEM and OpenSSH private-key blocks, authenticated URLs, sensitive configuration assignments, contextual 20-hex OAuth client IDs and 40-hex OAuth secrets, analytics identifiers, historical path names, and all versions of configuration files. Four unique ZIP blobs and one gzip challenge blob in WriteUps were decompressed in memory; none was encrypted. The historical CTF tutorial LeanCloud screenshots were also checked against identical local copies: displayed app and master-key fields are visibly redacted.

No network request was made, so current provider-side validity cannot be tested. A structurally valid OAuth secret is treated as plausible until the provider or owner confirms revocation. This is stricter than treating public client identifiers or analytics IDs as authentication secrets.

## Exact source-object coverage

Counts are for objects reachable from the specified ref. Blob bytes are uncompressed content bytes.

| Repository and ref | Tip | Commits | Merges | Trees | Blobs | Blob bytes |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Root `refs/remotes/origin/master` | [b6d7e299c8a98dee349f8d1c4d2dd38a06bcc8d0](https://github.com/deut-erium/deut-erium.github.io/commit/b6d7e299c8a98dee349f8d1c4d2dd38a06bcc8d0) | 91 | 1 | 196 | 361 | 4,188,666 |
| WriteUps `refs/remotes/origin/master` | [905279fcb7d35e381a5e3c0ddd2a91af0ff6d343](https://github.com/deut-erium/WriteUps/commit/905279fcb7d35e381a5e3c0ddd2a91af0ff6d343) | 254 | 15 | 1,017 | 1,182 | 15,971,600 |
| CTF tutorials `refs/remotes/origin/master` | [db082fa9a7e3e2b7084fd166995dde4eda6ff522](https://github.com/deut-erium/ctf-tutorials/commit/db082fa9a7e3e2b7084fd166995dde4eda6ff522) | 206 | 6 | 429 | 597 | 17,637,315 |
| Ramblings `refs/remotes/origin/main` | [fd78c8215cb774ab17b4daec4cd342fb858e4e0a](https://github.com/deut-erium/ramblings/commit/fd78c8215cb774ab17b4daec4cd342fb858e4e0a) | 27 | 0 | 94 | 274 | 1,305,075 |

## Root `master`

Verdict: safe to attach under the credential and private-material gate.

### Checked

- No strong-format provider token, private-key block, authenticated URL, concrete sensitive assignment, or standalone 40-hex credential candidate was found in the 361 reachable blobs.
- Nine flag-shaped blob versions were found. They belong to public CTF teaching content under the [assignment flag directory](https://github.com/deut-erium/deut-erium.github.io/tree/b6d7e299c8a98dee349f8d1c4d2dd38a06bcc8d0/assigments/flags), [assignment task material](https://github.com/deut-erium/deut-erium.github.io/blob/b6d7e299c8a98dee349f8d1c4d2dd38a06bcc8d0/assigments/what%20are%20assignments/task2.txt), and historical CTF lesson posts. They are challenge answers, not reusable credentials.

### Privacy history

Concrete Google Analytics identifiers occur in 83 of 91 reachable commits. The affected path classes are [early index.html](https://github.com/deut-erium/deut-erium.github.io/blob/e0ed371d246b66b2f57f96f6273542c367aac953/index.html#L5-L11), [assets/index.html](https://github.com/deut-erium/deut-erium.github.io/blob/45ac031f235610a4dc20eb12f6168fd45a4b21e2/assets/index.html#L5-L11), [the early analytics include](https://github.com/deut-erium/deut-erium.github.io/blob/ae835c930e672704a352ca08ce0785527b32720e/_includes/analytics.html#L1-L9), [the later provider include](https://github.com/deut-erium/deut-erium.github.io/blob/13693a8affbe840e703d0b8b438bc8aeda4b8984/_includes/analytics-providers/google.html#L15-L19), and [_config.yml](https://github.com/deut-erium/deut-erium.github.io/blob/3fc30cb6d428af7beb98ddd43d3f6cb30b6ba1ec/_config.yml#L168-L174). These identifiers do not grant account access. Historical builds containing the scripts could send visitor events to Google.

## WriteUps `master`

Verdict: safe to attach under the credential and private-material gate.

### Checked

- No provider token, authenticated URL, concrete application credential, or unrelated private key was found in the 1,182 reachable blobs.
- The scanner found 156 flag-shaped blob versions with 257 occurrences. All map to named CTF event writeups, solver code, challenge outputs, or earlier pre-Jekyll versions of those same files. The current [pseudo-key challenge flag](https://github.com/deut-erium/WriteUps/blob/905279fcb7d35e381a5e3c0ddd2a91af0ff6d343/_posts/2020/redpwn/crypto/pseudo-key/flag.txt) is representative of this class.
- Six historical blob versions contain an OpenSSH private-key block. Every version belongs to the RACTF "Mysterious Masquerading Message" challenge, including its [published id_rsa.txt](https://github.com/deut-erium/WriteUps/blob/905279fcb7d35e381a5e3c0ddd2a91af0ff6d343/_posts/2020/ractf/crypto/Mysterious_Masquerading_Message/id_rsa.txt), writeup, solver, and pre-Jekyll predecessor. The writeup treats the block as challenge ciphertext and extracts the challenge answer from it; it is not an operational SSH identity.
- Archive names such as `password.txt`, `flag.txt`, and the 345-entry password-manager corpus occur inside named crypto challenges. The archives are unencrypted challenge distributions. The [password-manager archive](https://github.com/deut-erium/WriteUps/blob/905279fcb7d35e381a5e3c0ddd2a91af0ff6d343/_posts/2020/redpwn/crypto/worst-pw-manager/worst-pw-manager.zip) is the largest example.
- The one historical Travis file has no plaintext or encrypted `secure` credential field.

### Privacy history

Concrete Google Analytics identifiers occur in 132 of 254 reachable commits, in [_config.yml](https://github.com/deut-erium/WriteUps/blob/72aec3ec8ce01acf1d296f86bb5ec1b6902ae233/_config.yml#L1-L4) and [the historical analytics include](https://github.com/deut-erium/WriteUps/blob/7abbee9e83a3a1c603ea62df183f8ad6b25ad66e/_includes/analytics.html#L1-L8). They are tracking identifiers, not authentication secrets.

## CTF tutorials `master`

Verdict: blocked as-is. The current tree deleted the affected `docs/` files, but the full branch still reaches their blobs.

### Affected: imported TeXt demo credentials

[The imported documentation configuration](https://github.com/deut-erium/ctf-tutorials/blob/45c87e2e3135778b46fba8fa2c77695ea1e42de5/docs/_config.yml#L123-L179) contains all of the following concrete values:

- a 20-hex Gitalk OAuth client ID, which is a public application identifier;
- a 40-hex Gitalk OAuth client secret, which is a plausible authentication credential;
- a LeanCloud app ID and app key, repeated for comments and page views;
- a Google Analytics tracking ID.

The LeanCloud app key is designed for browser clients and is not equivalent to a master key, but it identifies and authorizes use of the external app subject to that app's ACL. Its ownership and current state are unknown. It should not be copied into the unified repository.

The same LeanCloud app ID, app key, and analytics ID are repeated in the [English 1.x-to-2.x migration document](https://github.com/deut-erium/ctf-tutorials/blob/45c87e2e3135778b46fba8fa2c77695ea1e42de5/docs/_docs/en/1.7-update-from-1-to-2.md#L146-L175) and [Chinese migration document](https://github.com/deut-erium/ctf-tutorials/blob/45c87e2e3135778b46fba8fa2c77695ea1e42de5/docs/_docs/zh/1.7-update-from-1-to-2.md#L146-L175).

Credential-bearing blobs:

- `docs/_config.yml`: `49189072a9cfb2c2fa2f9b17c618e7a1827c9997`
- `docs/_docs/en/1.7-update-from-1-to-2.md`: `e56677165f360e9f4af656332bd7c560a76b2683`
- `docs/_docs/zh/1.7-update-from-1-to-2.md`: `d584bf36fa0ae0de6c0d279fbfd8be56a90a763b`

All three blobs are present in the same nine reachable commit snapshots:

- [45c87e2e3135778b46fba8fa2c77695ea1e42de5](https://github.com/deut-erium/ctf-tutorials/commit/45c87e2e3135778b46fba8fa2c77695ea1e42de5)
- [154957410897473c4a48d1af34625d49638920ad](https://github.com/deut-erium/ctf-tutorials/commit/154957410897473c4a48d1af34625d49638920ad)
- [6767dcc4a0281ecdb660df90132945a6c431a9cf](https://github.com/deut-erium/ctf-tutorials/commit/6767dcc4a0281ecdb660df90132945a6c431a9cf)
- [de32a2c34f0c8368d39e4d87226d83ceb2db5fde](https://github.com/deut-erium/ctf-tutorials/commit/de32a2c34f0c8368d39e4d87226d83ceb2db5fde)
- [b932e4c8eae830714c9dd626c383bf20e25c36e3](https://github.com/deut-erium/ctf-tutorials/commit/b932e4c8eae830714c9dd626c383bf20e25c36e3)
- [f83ae8f416885d30a7f8f8159d06ce73de1fe567](https://github.com/deut-erium/ctf-tutorials/commit/f83ae8f416885d30a7f8f8159d06ce73de1fe567)
- [37012936e668d558b98c06640da446a91bb912f4](https://github.com/deut-erium/ctf-tutorials/commit/37012936e668d558b98c06640da446a91bb912f4)
- [5f742046d73a1df3bfebea2d033c1201711bb78e](https://github.com/deut-erium/ctf-tutorials/commit/5f742046d73a1df3bfebea2d033c1201711bb78e)
- [e167c1fe72698baeb4c7ae6de65a610126190d5d](https://github.com/deut-erium/ctf-tutorials/commit/e167c1fe72698baeb4c7ae6de65a610126190d5d)

[Commit 0344645ac6c2761744e196517f463514e64fcffa](https://github.com/deut-erium/ctf-tutorials/commit/0344645ac6c2761744e196517f463514e64fcffa) deletes the vendor `docs/` tree. That deletion does not make the three older blobs unreachable from `master`.

### Checked and not applicable

- The Gitalk and LeanCloud fields in the site's root `_config.yml` are empty template slots, not concrete credentials.
- The `clientID` and `clientSecret` examples in the English and Chinese `2.1-configuration.md` documents are placeholders, not the concrete OAuth pair above.
- Three other 40-hex hits in `_data/authors.yml` are avatar hashes.
- The LeanCloud screenshots do not expose the app, client, or master-key values. The key fields are visibly covered.
- Thirty-four flag-shaped blob versions occur in seven CTF lesson or assignment path classes, including [the assignment lesson](https://github.com/deut-erium/ctf-tutorials/blob/db082fa9a7e3e2b7084fd166995dde4eda6ff522/_posts/2021-07-04-what%20are%20assignments.md) and [task material](https://github.com/deut-erium/ctf-tutorials/blob/db082fa9a7e3e2b7084fd166995dde4eda6ff522/assigments/what%20are%20assignments/task2.txt). These are public teaching flags.

### Impact and fix

Attaching the unmodified branch would copy the three credential-bearing blobs and all nine retaining commits into the unified object graph. Deleting `docs/` in a later unified commit would not remove them.

Create a rewritten import ref that removes or redacts the three paths in every affected snapshot. Dropping the entire nine-commit imported vendor-doc class is also reasonable if none of those commits contains project-authored tutorial work that must be preserved. The rewritten ref must be scanned again before attachment. Provider-side revocation status is unknown because this review was offline.

### Privacy history

Analytics identifiers occur in 204 of 206 source commits. They appear in the root [_config.yml](https://github.com/deut-erium/ctf-tutorials/blob/de32a2c34f0c8368d39e4d87226d83ceb2db5fde/_config.yml#L171-L177) and the three affected vendor documentation paths above. They are not authentication secrets, but historical builds could report visits to the configured analytics property.

## Ramblings `main`

Verdict: blocked as-is. This is a separate first-party credential exposure, not the CTF tutorial vendor-doc issue.

### Affected: Gitalk OAuth pair in source history

[Commit 93b552ac7872bd1a8389d7378462c74977dd64a5](https://github.com/deut-erium/ramblings/blob/93b552ac7872bd1a8389d7378462c74977dd64a5/_config.yml#L121-L131) introduces one concrete 20-hex Gitalk client ID and one concrete 40-hex Gitalk client secret in `_config.yml`. Both remain unchanged through [the main tip](https://github.com/deut-erium/ramblings/blob/fd78c8215cb774ab17b4daec4cd342fb858e4e0a/_config.yml#L122-L132).

The exact affected source commit class is `93b552ac7872bd1a8389d7378462c74977dd64a5^..fd78c8215cb774ab17b4daec4cd342fb858e4e0a`: 23 consecutive commits in this no-merge history. Six `_config.yml` blob revisions carry the pair:

- `dc46f0113900384a7bd154b03948b4e0d0aa372d`
- `cd17a5715a61858136df992bc8e933fab47df792`
- `d27365676eefa4780f6e372aa1cb3192ebe31828`
- `fde4d158b8dca69113a24d6e81c545b0aa1b7558`
- `24b8a218cf4fda8ce1bd38d9c28b56bf5a8aaed2`
- `c794a3d5ed8cf0ffea327c0d936c666a62333e2a`

Gitalk becomes the enabled comments provider at [commit db6e33a8de3c23ba8211e21ac3ce5b108a8f91f8](https://github.com/deut-erium/ramblings/commit/db6e33a8de3c23ba8211e21ac3ce5b108a8f91f8), the eighth commit. The OAuth pair was therefore present for three source snapshots before activation and for every snapshot after activation.

### Affected: generated HTML copies

Both commits on `refs/remotes/origin/gh-pages`, `8f7db2542359bd907034dfa7a819c64c30e7b087` and `4bcfdbd06906bf450f455704515724be2bd773db`, render the same client ID and secret into six public HTML paths:

- [2022/02/01/welcome.html](https://github.com/deut-erium/ramblings/blob/4bcfdbd06906bf450f455704515724be2bd773db/2022/02/01/welcome.html#L2028), blob `169f3c5600c3ba509c4173feaa4f57bec7b00b20`
- [2022/02/02/randoblurry0001.html](https://github.com/deut-erium/ramblings/blob/4bcfdbd06906bf450f455704515724be2bd773db/2022/02/02/randoblurry0001.html#L2130), blob `7d9f20387a1daa37834b7522dd0ed139daa81147`
- [2022/02/03/randoblurry-test.html](https://github.com/deut-erium/ramblings/blob/4bcfdbd06906bf450f455704515724be2bd773db/2022/02/03/randoblurry-test.html#L2066), blob `ee87721a7bd17dc1c91a287d6e5e375b5eef8bc4`
- [2022/02/04/randoblurry-update.html](https://github.com/deut-erium/ramblings/blob/4bcfdbd06906bf450f455704515724be2bd773db/2022/02/04/randoblurry-update.html#L2026), blob `b47d2b2f9454b548149b49cf406294ca1f32a732`
- [about.html](https://github.com/deut-erium/ramblings/blob/4bcfdbd06906bf450f455704515724be2bd773db/about.html#L2022), blob `9e032f5b910b64065c072d847f5395a2b342c686`
- [index.html](https://github.com/deut-erium/ramblings/blob/4bcfdbd06906bf450f455704515724be2bd773db/index.html#L2150), blob `47b0956f93d257d70338228ad623b1b3a748c380`; the first generated commit uses earlier blob `dc5ed6f65fa395c23932218c6fc43e8ec1028e37`

No other `main` path or generated path contains that OAuth pair.

### Checked

No second credential pair, unrelated private key, provider token, authenticated URL, flag, or secret-bearing archive was found in the 274 `main` blobs. Generic Gitalk and LeanCloud includes contain Liquid template references only.

### Impact and fix

The client ID is public by design; the paired OAuth client secret is not. It must be treated as compromised. Depending on the OAuth app's current redirect and authorization settings, disclosure can support client impersonation or unauthorized authorization-code exchange.

Revoke or rotate the GitHub OAuth app secret before migration. Keep Gitalk disabled in the unified site. Rewrite all 23 affected source snapshots so the ID and secret are absent or replaced by inert markers, then scan the rewritten ref. Do not attach either Ramblings `gh-pages` commit. Rewriting only the tip or deleting `_config.yml` after a merge leaves the old blobs reachable. Sanitizing the unified import does not remove the already-public values from the old Ramblings repository, so provider-side rotation remains necessary.

### Privacy history

Google Analytics is the selected provider in all 27 `main` commits, and concrete analytics identifiers occur in `_config.yml` in all 27. The identifier set changes in [commit 84c3350603b8c26ee30aabf9304955fa3eb66970](https://github.com/deut-erium/ramblings/blob/84c3350603b8c26ee30aabf9304955fa3eb66970/_config.yml#L169-L177). These values do not authenticate to Google.

The final generated branch emits analytics code in eight HTML paths: the six Gitalk-bearing pages above plus [2022/07/01/what-is-ai.html](https://github.com/deut-erium/ramblings/blob/4bcfdbd06906bf450f455704515724be2bd773db/2022/07/01/what-is-ai.html#L3-L18) and [archive.html](https://github.com/deut-erium/ramblings/blob/4bcfdbd06906bf450f455704515724be2bd773db/archive.html#L3-L18). Importing the source history is acceptable after credential sanitization even if these tracking IDs remain as historical privacy metadata, but the unified active configuration should stay analytics-free unless tracking is approved again.

## Generated branch decision

| Generated history | Tip | Commits | Trees | Blobs | Blob bytes | Relationship to source |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Root `gh-pages` | `3747c082a1f6ce600da81050223d74b19f1b35ba` | 38 | 108 | 214 | 19,928,923 | No merge base with root `master` |
| WriteUps local `gh-pages` | `a3793186f73da3d06884dca81e71b0892373e5ca` | 219 | 1,538 | 1,693 | 143,217,025 | Shares source history through `8a452be108fe3ccbf4816824050b19e4f095a969`; adds 26 generated-only commits |
| CTF tutorials `gh-pages` | `d1cd41ae608c23a1923fdf68394977f042fe69a4` | 2 | 23 | 56 | 4,958,952 | No merge base with CTF tutorials `master` |
| Ramblings `gh-pages` | `4bcfdbd06906bf450f455704515724be2bd773db` | 2 | 16 | 47 | 2,961,959 | No merge base with Ramblings `main` |

None of these generated refs should be attached to the unified branch. Source history already records the authored changes, while generated history adds duplicate HTML, bundled assets, tracking scripts, and unstable build products. The WriteUps branch is especially costly at about 143 MB of reachable blob content and adds no authored history beyond commits already shared with source.

The root generated branch contains the only acquired copy of `/new-tetris/`. Copy the required `new-tetris` files from the vetted `3747c082a1f6ce600da81050223d74b19f1b35ba` tree into one clean source commit. Do not preserve the generated branch ancestry merely to retain that application.

## Import gate

Proceed with the full root and WriteUps source histories. Block CTF tutorials and Ramblings until rewritten refs pass the same reachable-blob scan. Do not attach any generated ref. This decision preserves public CTF keys and flags as authored content while excluding plausible provider credentials and known OAuth material.
