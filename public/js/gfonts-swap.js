document.querySelectorAll('link[data-gfonts-preload]').forEach(function (link) {
  link.addEventListener('load', function () { this.media = 'all'; });
});
