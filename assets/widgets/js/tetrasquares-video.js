(() => {
  'use strict';

  document.querySelectorAll('.tetrasquares-video[data-youtube-id]').forEach((video) => {
    const id = video.dataset.youtubeId;
    const button = video.querySelector('[data-load-youtube]');
    if (!button || !/^[A-Za-z0-9_-]{11}$/.test(id || '')) return;

    button.hidden = false;
    button.addEventListener('click', () => {
      const player = document.createElement('iframe');
      player.src = `https://www.youtube-nocookie.com/embed/${id}`;
      player.title = video.dataset.videoTitle || 'YouTube video';
      player.width = '560';
      player.height = '315';
      player.referrerPolicy = 'strict-origin-when-cross-origin';
      player.allow = 'encrypted-media; fullscreen; picture-in-picture';
      player.allowFullscreen = true;
      player.tabIndex = 0;
      button.replaceWith(player);
      player.focus();
    }, { once: true });
  });
})();
