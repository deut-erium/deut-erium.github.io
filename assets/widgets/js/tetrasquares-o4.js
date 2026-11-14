(() => {
  'use strict';

  if (!('IntersectionObserver' in window) || !('animate' in Element.prototype)) return;

  document.querySelectorAll('[data-o4-animation]').forEach((figure) => {
    const pieces = Array.from(figure.querySelectorAll('[data-o4-piece]'));
    const gold = figure.querySelector('[data-o4-gold]');
    const control = figure.querySelector('[data-o4-replay]');
    if (pieces.length !== 4 || !gold || !control) return;

    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let animations = [];
    let generation = 0;
    let timer;
    let visible = false;
    let playing = false;
    let pausedByUser = false;

    function stop() {
      ++generation;
      clearTimeout(timer);
      animations.forEach((animation) => animation.cancel());
      animations = [];
      playing = false;
      figure.classList.remove('is-o4-animated');
      control.textContent = 'Play animation';
    }

    function play(repeat) {
      stop();
      const current = generation;
      playing = true;
      figure.classList.add('is-o4-animated');
      control.textContent = 'Pause animation';

      async function cycle() {
        if (current !== generation) return;
        animations.forEach((animation) => animation.cancel());
        animations = pieces.map((piece, index) => piece.animate([
          { opacity: 1, transform: `translateY(-${piece.dataset.drop}px)` },
          { opacity: 1, transform: 'translateY(0)' },
        ], { duration: 500, delay: index * 600, easing: 'ease-in', fill: 'forwards' }));
        animations.push(gold.animate([
          { opacity: 0 },
          { opacity: 1 },
        ], { duration: 450, delay: 2600, fill: 'forwards' }));
        try {
          await Promise.all(animations.map((animation) => animation.finished));
          if (current !== generation) return;
          if (repeat) timer = setTimeout(cycle, 1200);
          else {
            playing = false;
            control.textContent = 'Replay animation';
          }
        } catch (error) {
          if (error.name !== 'AbortError') throw error;
        }
      }
      cycle();
    }

    const observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      const next = entry.isIntersecting && entry.intersectionRatio >= 0.5;
      if (next === visible) return;
      visible = next;
      if (!visible) stop();
      else if (!motion.matches && !pausedByUser) play(true);
    }, { threshold: 0.5 });

    control.hidden = false;
    control.addEventListener('click', () => {
      pausedByUser = playing;
      if (playing) stop();
      else play(!motion.matches);
    });
    motion.addEventListener('change', () => {
      stop();
      if (!motion.matches && visible && !pausedByUser) play(true);
    });
    observer.observe(figure);
  });
})();
