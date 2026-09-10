---
layout: page
title: About
description: "Himanshu Sheoran, also known as deuterium: cryptography research, security engineering and CTFs."
page_width: wide
stylesheets:
  - /assets/resume/resume.css
---

<div class="resume-profile">
  <p>I'm Himanshu Sheoran, also known as deuterium. I lead cryptographic research, engineering and audits at <a href="https://osec.io/">OtterSec</a>. Previously, I worked on Google's confidential computing, trying to encrypt VMs for some reason, and VMware's (actually RIP) Carbon Black XDR (a corpo way to say antivirus). Gallivanting through this site, you have probably figured out that I love cryptography, CTFs, and hammering anything and everything with SMT solvers.</p>
  <p>If you run into another deuterium with an Escher avatar and a love of <a href="https://deut-erium.github.io/pyfractal/">fractals</a> and metal, it's probably me.</p>

  <details id="resume-details" class="resume-disclosure">
    <summary>Hire me?</summary>
    <div class="resume-workshop" aria-labelledby="resume-heading">
      <h2 id="resume-heading">Resume</h2>
      <p>Oh no, my resume doesn't seem to satisfy your HR filters? No worries, add all your roles and responsibilities and keywords here.</p>

      <div class="resume-builder">
        <form id="resume-form">
          <label for="request">hr_filters.txt</label>
          <textarea id="request" rows="12" maxlength="12000" spellcheck="false">Must have 10 years of experience with a framework released last Tuesday.
Required: 15 years of production Rust experience, starting before Rust 1.0.
Can explain elliptic curves to a submarine crew during an active kraken incident.
Must rotate signing keys without waking the kraken.
Has deployed zero-knowledge proofs to a TI-84 calculator at planetary scale.
Can debug Byzantine consensus by reading packet captures and tea leaves.
Must know every programming language, including the ones we invent during the interview.
Available 25 hours a day across Earth, Mars and the Byzantine fault domain.
Willing to relocate to /dev/null; compensation includes exposure and one company hoodie.</textarea>
          <div class="resume-solve-action">
            <button id="compile" type="submit" disabled>Build tailored PDF</button>
          </div>
          <output id="resume-status" role="status" aria-live="polite">Preparing the resume...</output>
        </form>
        <section id="resume-result" aria-label="Resume preview">
          <header class="resume-preview-head">
            <span>resume.pdf <span id="page-count"></span></span>
            <a id="download" download hidden>Download resume</a>
          </header>
          <div id="preview" tabindex="0" role="region" aria-label="Resume pages. Scroll to read the full document."><p>Open this section to prepare the preview.</p></div>
        </section>
      </div>
      <noscript><p>The resume generator needs JavaScript. Contact me through one of the links below and I will send the PDF.</p></noscript>
    </div>
  </details>

  <p>HACK THE PLANET.</p>
  <p>PS: <a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">DO NOT CLICK</a></p>
</div>
<script type="module" src="{{ '/assets/resume/app.mjs' | relative_url }}?v={{ '/' | asset_v }}"></script>
