// STARFIELD PARTICLES - Flaynn v3
(function(){
  const canvas = document.getElementById('canvas-bg');
  if (!canvas) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ctx = canvas.getContext('2d');
  let W, H, particles;
  const mouse = { x: null, y: null };
  const isMobile = window.innerWidth < 768;
  const N = isMobile ? 40 : 70;
  const DIST = 140;

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function Particle() {
    this.x = Math.random() * W;
    this.y = Math.random() * H;
    this.vx = (Math.random() - 0.5) * 0.3;
    this.vy = (Math.random() - 0.5) * 0.3;
    this.r = Math.random() * 1.4 + 0.4;
    const colors = ['#7B2D8E', '#9333ea', '#E8651A', '#EC4899', '#FACC15'];
    this.color = colors[Math.floor(Math.random() * colors.length)];
    this.op = Math.random() * 0.5 + 0.15;
  }

  Particle.prototype.update = function() {
    if (mouse.x) {
      const dx = this.x - mouse.x, dy = this.y - mouse.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 180) {
        const f = ((180 - d) / 180) * 0.01;
        this.vx += dx * f;
        this.vy += dy * f;
      }
    }
    this.vx *= 0.99; this.vy *= 0.99;
    this.x += this.vx; this.y += this.vy;
    if (this.x < 0) this.x = W; if (this.x > W) this.x = 0;
    if (this.y < 0) this.y = H; if (this.y > H) this.y = 0;
  };

  function init() { particles = Array.from({ length: N }, () => new Particle()); }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    for (let i = 0; i < particles.length; i++) {
      particles[i].update();
      ctx.beginPath();
      ctx.arc(particles[i].x, particles[i].y, particles[i].r, 0, Math.PI * 2);
      ctx.fillStyle = particles[i].color;
      ctx.globalAlpha = particles[i].op;
      ctx.fill();
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < DIST) {
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = 'rgba(123,45,142,' + (1 - d / DIST) * 0.1 + ')';
          ctx.globalAlpha = 1;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', () => { resize(); init(); });
  window.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
  window.addEventListener('mouseleave', () => { mouse.x = null; mouse.y = null; });
  resize(); init(); draw();
})();
