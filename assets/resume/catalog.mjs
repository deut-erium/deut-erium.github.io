// Fixed biography and review record. Visitor input never changes these fields.
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
export const person = freeze({
  name: 'Himanshu Sheoran', alias: 'deuterium',
  headline: ['Security Software Engineer', 'Cryptography', 'OtterSec'],
  email: 'himanshu_sheoran@yahoo.com', website: 'https://deut-erium.github.io',
  github: 'https://github.com/deut-erium',
  linkedin: 'https://www.linkedin.com/in/himanshu-sheoran-ab047b152',
});
export const education = freeze({
  title: 'Indian Institute of Technology Bombay', date: '2017-2021',
  detail: 'Bachelor of Technology in Computer Science and Engineering', note: 'With Honors',
});
export const audits = freeze([
  {
    "id": "jolt",
    "title": "Jolt",
    "repo": "https://github.com/a16z/jolt",
    "summary": [
      {
        "text": "Led the proving-system and RISC-V review; co-developed Z3 tooling for instruction soundness."
      }
    ],
    "links": [
      {
        "label": "Writeup",
        "url": "https://hackmd.io/XXXqofd_SvmPyuOzxPX5Ag"
      },
      {
        "label": "#1118",
        "url": "https://github.com/a16z/jolt/pull/1118"
      },
      {
        "label": "#1257",
        "url": "https://github.com/a16z/jolt/pull/1257"
      },
      {
        "label": "#981",
        "url": "https://github.com/a16z/jolt/pull/981"
      },
      {
        "label": "#1156",
        "url": "https://github.com/a16z/jolt/pull/1156"
      },
      {
        "label": "#1189",
        "url": "https://github.com/a16z/jolt/pull/1189"
      },
      {
        "label": "#1255",
        "url": "https://github.com/a16z/jolt/pull/1255"
      },
      {
        "label": "#1259",
        "url": "https://github.com/a16z/jolt/pull/1259"
      },
      {
        "label": "#1335",
        "url": "https://github.com/a16z/jolt/pull/1335"
      },
      {
        "label": "#1415",
        "url": "https://github.com/a16z/jolt/pull/1415"
      }
    ],
    "referencePrefix": "References: ",
    "bareReferences": true
  },
  {
    "id": "stacks-wsts",
    "title": "Stacks WSTS",
    "repo": "https://github.com/Trust-Machines/wsts",
    "summary": [
      {
        "text": "Reviewed weighted Schnorr signing: key IDs, share validation and threshold checks."
      }
    ],
    "links": [
      {
        "label": "Report",
        "url": "https://osec.io/reports/stacks_wsts_audit_final.pdf"
      }
    ]
  },
  {
    "id": "ika-library",
    "title": "IKA / dWallet",
    "repo": "https://github.com/dwallet-labs/inkrypto",
    "summary": [
      {
        "text": "Reviewed inkrypto's 2PC-MPC ECDSA protocol and supporting group arithmetic."
      }
    ],
    "links": [
      {
        "label": "Report",
        "url": "https://osec.io/reports/ika_audit_final.pdf"
      }
    ]
  }
]);
export const research = freeze([
  {
    "id": "dusk-research",
    "title": "Dusk PLONK",
    "repo": "https://github.com/dusk-network/plonk",
    "summary": [
      {
        "text": "Found unverified evaluations allowing forged proofs and unauthorized minting."
      }
    ],
    "links": [
      {
        "label": "Fix",
        "url": "https://github.com/dusk-network/plonk/commit/645265b748d2698bcb403b794fc2d58340b340f1"
      },
      {
        "label": "Blog",
        "url": "https://osec.io/blog/unverified-evaluations-dusk-plonk/"
      }
    ]
  },
  {
    "id": "triton-research",
    "title": "Triton VM",
    "repo": "https://github.com/TritonVM/triton-vm",
    "summary": [
      {
        "text": "Researched a critical vulnerability in the proof system underpinning Neptune Cash."
      }
    ],
    "links": [
      {
        "label": "Disclosure",
        "url": "https://neptune.cash/articles/critical-vulnerability-disclosure"
      }
    ]
  },
  {
    "id": "jellyfish-research",
    "title": "Jellyfish",
    "repo": "https://github.com/EspressoSystems/jellyfish",
    "summary": [
      {
        "text": "Found nine unbound lookup evaluations allowing forged UltraPlonk proofs."
      }
    ],
    "links": [
      {
        "label": "Fix",
        "url": "https://github.com/EspressoSystems/jellyfish/pull/867"
      },
      {
        "label": "Blog",
        "url": "https://osec.io/blog/unverified-evaluations-dusk-plonk/"
      }
    ]
  },
  {
    "id": "nexus-research",
    "title": "Nexus",
    "repo": "https://github.com/nexus-xyz/nexus-zkvm",
    "summary": [
      {
        "text": "Found unbound lookup sums allowing false execution claims to pass STARK verification."
      }
    ],
    "links": [
      {
        "label": "Fix",
        "url": "https://github.com/nexus-xyz/nexus-zkvm/pull/503"
      },
      {
        "label": "Blog",
        "url": "https://osec.io/blog/zkvms-unfaithful-claims/"
      }
    ]
  },
  {
    "id": "cairo-research",
    "title": "Cairo-M",
    "repo": "https://github.com/kkrt-labs/cairo-m",
    "summary": [
      {
        "text": "Found unbound public data allowing forged outputs, registers and memory roots."
      }
    ],
    "links": [
      {
        "label": "Fix",
        "url": "https://github.com/kkrt-labs/cairo-m/pull/352/commits/92b6740937e904e0002e7ee099fec357127c1d16"
      },
      {
        "label": "Blog",
        "url": "https://osec.io/blog/zkvms-unfaithful-claims/"
      }
    ]
  },
  {
    "id": "ceno-research",
    "title": "Ceno",
    "repo": "https://github.com/scroll-tech/ceno",
    "summary": [
      {
        "text": "Found unbound read/write claims allowing forged GKR and tower-sumcheck proofs."
      }
    ],
    "links": [
      {
        "label": "Fix",
        "url": "https://github.com/scroll-tech/ceno/pull/1262"
      },
      {
        "label": "Blog",
        "url": "https://osec.io/blog/zkvms-unfaithful-claims/"
      }
    ]
  },
  {
    "id": "expander-research",
    "title": "Expander",
    "repo": "https://github.com/PolyhedraZK/Expander",
    "summary": [
      {
        "text": "Found unbound public inputs allowing forged outputs to pass GKR verification."
      }
    ],
    "links": [
      {
        "label": "Fix",
        "url": "https://github.com/PolyhedraZK/Expander/commit/4a8c2be03535194c1f6b48a93ad2f5480649f7c2"
      },
      {
        "label": "Blog",
        "url": "https://osec.io/blog/zkvms-unfaithful-claims/"
      }
    ]
  },
  {
    "id": "binius-research",
    "title": "Binius64",
    "repo": "https://github.com/binius-zk/binius64",
    "summary": [
      {
        "text": "Found unbound public witnesses allowing false program inputs and outputs."
      }
    ],
    "links": [
      {
        "label": "Fix",
        "url": "https://github.com/binius-zk/binius64/pull/1355/commits/86a515f0632d2acdf547ed82780dfe7f9f39358f"
      },
      {
        "label": "Blog",
        "url": "https://osec.io/blog/zkvms-unfaithful-claims/"
      }
    ]
  },
  {
    "id": "lean-research",
    "title": "leanMultisig",
    "repo": "https://github.com/leanEthereum/leanMultisig",
    "summary": [
      {
        "text": "Found unbound bytecode and public inputs in a post-quantum Ethereum zkVM."
      }
    ],
    "links": [
      {
        "label": "Fix",
        "url": "https://github.com/leanEthereum/leanMultisig/commit/7f308da6a0720b2f136e88a6250f68e796c3c3e2"
      }
    ]
  }
]);
export const experience = freeze([
  {
    "id": "ottersec",
    "audits": audits,
    "research": research,
    "title": "OtterSec",
    "date": "Current",
    "subtitle": "Cryptography research, engineering and team leadership",
    "bullets": [
      "Lead cryptographic vulnerability research, performance engineering, audits and bug-bounty investigations.",
      "Audit cryptographic libraries and privacy protocols: ZK proofs, zkVMs, MPC and threshold signatures.",
      "Lead three cryptography engineers, setting research priorities and allocating work across client audits.",
      "Scope audit engagements, prepare quotes and technical proposals, and manage client communications."
    ]
  },
  {
    "id": "google",
    "title": "Software Engineer - Google Cloud Security",
    "date": "October 2023 - November 2024",
    "subtitle": "Confidential Compute VM",
    "location": "Pune",
    "url": "https://cloud.google.com/confidential-computing",
    "bullets": [
      "Worked on providing encryption-in-use on Google Cloud with Intel TDX on Emerald Rapids, bringing confidential computing to C4 VMs through guest and host kernel patches.",
      "Helped lead the cryptography category of Google CTF 2024; designed and implemented three cryptography challenges."
    ]
  },
  {
    "id": "vmware",
    "title": "VMware - Member of Technical Staff 2",
    "date": "July 2021 - October 2023",
    "subtitle": "CarbonBlack Windows Sensor",
    "location": "Pune",
    "bullets": [],
    "groups": [
      {
        "title": "CIS Benchmarking",
        "bullets": [
          "Conceptualized and implemented a compliance management module for automated scalable hardening and remediation of security configurations across various Windows OSes and profiles based on OVAL rules.",
          "Designed efficient formats for CIS Benchmarks running 10000 times faster than CIS-CAT Pro."
        ]
      },
      {
        "title": "CarbonBlack XDR",
        "bullets": [
          "Aided kernel integration of the LastLine IDS engine and solidified it with extensive kernel-mode tests.",
          "Developed a user-mode pcap replay tool for Windows independent of any kernel-mode packet capture libraries."
        ]
      },
      {
        "title": "Cloud Workload Protection",
        "bullets": [
          "Worked with VDI to implement automatic sensor re-registration for cloned VMs on Azure.",
          "Worked on developing sensor installation scripts using launch scripts on GCP and Azure."
        ]
      },
      {
        "title": "Team Development",
        "bullets": [
          "Organized an internal Capture the Flag event for enhancing internal security practices at the Pune office.",
          "Automated development machine setup, cutting manual setup time from 2 days of work to 2 hours."
        ]
      }
    ]
  },
  {
    "id": "sekai",
    "title": "Project Sekai - International CTF Team",
    "date": "May 2022 - Present",
    "url": "https://sekai.team/",
    "bullets": [
      "Overall world rank 6 in CTF competitions in 2023, winning 8 CTF competitions.",
      "Designed and authored cryptography challenges in SekaiCTF 2022 and SekaiCTF 2023."
    ]
  },
  {
    "id": "iitb-club",
    "title": "Cybersecurity Club IITB - Manager",
    "date": "May 2020 - May 2021",
    "url": "https://linktr.ee/csec.iitb",
    "bullets": [
      "Spearheaded a team of 10 people for planning and organising sessions, talks and CTF contests.",
      "Developed and maintained an active wiki and blog site about cybersecurity with 1000s of daily visitors worldwide.",
      "Organized intra-institute two-day Capture The Flag competitions with active participation of 250 people."
    ]
  },
  {
    "id": "bosch",
    "title": "BOSCH - Research Intern",
    "date": "May 2019 - July 2019",
    "bullets": [
      "Developed a retrofit prototype for automatic and optimal gear-shifting for derailleur-geared bicycles.",
      "Developed the Smart Shift mobile application for configuring the embedded system via Bluetooth."
    ]
  }
]);
export const awards = freeze([
  {
    "text": "Silver Medal in the 10th International Olympiad in Cryptography, NSUCRYPTO",
    "date": "2023",
    "url": "https://nsucrypto.nsu.ru/archive/2023/total_results/round/2/#data"
  },
  {
    "text": "Gold Medal in the 9th International Olympiad in Cryptography, NSUCRYPTO, with highest score",
    "date": "2022",
    "url": "https://nsucrypto.nsu.ru/archive/2022/total_results/round/2/#data"
  },
  {
    "text": "Gold Medal in the 8th International Olympiad in Cryptography, NSUCRYPTO, with highest score",
    "date": "2021",
    "url": "https://nsucrypto.nsu.ru/archive/2021/total_results/round/2/#data"
  },
  {
    "text": "Gold Medal in the 7th International Olympiad in Cryptography, NSUCRYPTO",
    "date": "2020",
    "url": "https://nsucrypto.nsu.ru/archive/2020/total_results/#data"
  },
  {
    "text": "Secured All India Rank 59 in JEE Advanced among 200,000 students in India",
    "date": "2017",
    "url": "https://en.wikipedia.org/wiki/Joint_Entrance_Examination_%E2%80%93_Advanced"
  },
  {
    "text": "Secured All India Rank 368 in JEE Main among 1.2 million students in India",
    "date": "2017",
    "url": "https://en.wikipedia.org/wiki/Joint_Entrance_Examination_%E2%80%93_Main"
  },
  {
    "text": "Secured All India Rank 194 in Kishore Vaigyanik Protsahan Yojana",
    "date": "2017",
    "url": "https://en.wikipedia.org/wiki/Kishore_Vaigyanik_Protsahan_Yojana"
  },
  {
    "text": "Amongst 350 students selected for INPhO and amongst the national top 1 percentile in NSEP",
    "date": "2016",
    "url": "https://en.wikipedia.org/wiki/Indian_National_Physics_Olympiad"
  },
  {
    "text": "Amongst 350 students selected for INChO and amongst the national top 1 percentile in NSEC",
    "date": "2016",
    "url": "https://en.wikipedia.org/wiki/Indian_National_Chemistry_Olympiad"
  }
]);
export const projects = freeze([
  {
    "title": "RNGeesus",
    "url": "https://github.com/deut-erium/RNGeesus",
    "bullets": [
      "Implemented new approaches for state and seed recovery of commonly used Pseudo Random Number Generators: Mersenne Twisters, LFSRs and Truncated Linear Congruential Generators using SMT modelling.",
      "Analyzed flaws in seed initialization of Mersenne Twisters to recover 19937-bit state and initial seed using 32 bits of output on a single-core machine in under 2 minutes."
    ]
  },
  {
    "title": "Automated Cryptanalysis",
    "url": "https://github.com/deut-erium/auto-cryptanalysis",
    "bullets": [
      "Implemented a state-of-the-art library for automated linear and differential cryptanalysis for SPN ciphers.",
      "Successfully cracked variants of ciphers as big as 128 bits and as deep as 10 rounds in 10 minutes."
    ]
  },
  {
    "title": "Secure Script Execution Server",
    "url": "https://github.com/deut-erium/SSES",
    "bullets": [
      "Developed a concurrent script execution server with a client, ensuring signed script execution for enhanced security.",
      "Implemented a custom messaging protocol and digital signature verification in C with OpenSSL.",
      "Ensured code reliability through rigorous unit testing, validating functionality and project stability."
    ]
  },
  {
    "title": "Pyfractal",
    "url": "https://github.com/deut-erium/pyfractal",
    "bullets": [
      "Developed an easy-to-use, fully documented Python library for generating brainfilling fractal curves.",
      "Integrated an intuitive GUI using Tkinter, enabling understanding of fractals without mathematical background.",
      "Packaged ready-to-use, open-source, multi-platform binaries for out-of-the-box working software."
    ]
  }
]);
export const blogs = freeze([
  {
    "title": "Personal Blog",
    "detail": "Covering my technical interests, wanderings and problems created by me.",
    "url": "https://deut-erium.github.io/"
  },
  {
    "title": "CTF Competition Writeups",
    "detail": "Containing my CTF challenge writeups from 2020-2022.",
    "url": "https://deut-erium.github.io/WriteUps"
  },
  {
    "title": "Cybersecurity Club IITB wiki",
    "detail": "Wiki pages for learning cybersecurity.",
    "url": "https://csea-iitb.github.io/IITBreachers-wiki/"
  }
]);
export const talks = freeze([
  {
    "title": "6th Indian SAT+SMT Winter School",
    "detail": "RNGeesus - State and seed recovery for RNGs using SMT solvers.",
    "url": "https://youtu.be/sM4rQ2c_8u0?t=6227"
  }
]);
export const skills = freeze([
  {
    "title": "Programming",
    "text": "Python, C, C++, bash, Powershell, SageMath, java, lisp"
  },
  {
    "title": "Development Tools",
    "text": "Git, Subversion, GitHub, Gitlab, VIM, tmux, Docker, Jekyll, AWS, Azure, ESX"
  },
  {
    "title": "Security Tools",
    "text": "Ghidra, Wireshark, IDA, gdb, windbg, Sysinternal suite, Z3, pwntools"
  }
]);

// This is deliberately a tiny text compiler, not an editor for the biography.
// It turns requests into claims without rejecting fanciful or unmatched roles.
export function compileRequest(value) {
  return String(value ?? '').normalize('NFC').split(/\r\n?|\n/u)
    .map(line => line.trim().replace(/^(?:[-*\u2022]\s+|\d+[.)]\s+)/u, ''))
    .filter(Boolean)
    .map(line => line
      .replace(/^(?:we (?:need|want|require)|i (?:need|want)|looking for|seeking)\s+(?:someone (?:who can|to)\s+|a candidate (?:who can|to)\s+)?/i, '')
      .replace(/^(?:must|should) (?:be able to|have experience (?:in|with))\s+/i, '')
      .replace(/^must have\s+/i, '')
      .replace(/^[a-z]/, char => char.toUpperCase()))
    .filter(Boolean);
}
export function compose(request = '') {
  return freeze({
    title: 'Resume', person, education, experience, awards, projects, blogs, talks, skills,
    qualifications: compileRequest(request),
  });
}
