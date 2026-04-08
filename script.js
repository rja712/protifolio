/* ============================================
   Ankit Raj — Portfolio
   Vanilla JS · theme, nav, reveal, count-up
   ============================================ */

(() => {
    const root = document.documentElement;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ---------- Theme ---------- */
    const themeBtn = document.querySelector('.theme-toggle');
    const stored = localStorage.getItem('theme');
    const initialTheme = stored || 'dark';

    const applyTheme = (theme) => {
        root.setAttribute('data-theme', theme);
        if (themeBtn) {
            themeBtn.setAttribute('aria-pressed', theme === 'light');
            themeBtn.setAttribute(
                'aria-label',
                theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
            );
        }
    };

    applyTheme(initialTheme);

    themeBtn?.addEventListener('click', () => {
        const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        localStorage.setItem('theme', next);
    });

    /* ---------- Sticky nav scroll state ---------- */
    const nav = document.querySelector('.nav');
    const onScroll = () => {
        if (!nav) return;
        nav.classList.toggle('scrolled', window.scrollY > 40);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    /* ---------- Smooth scroll with nav offset ---------- */
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', (e) => {
            const id = anchor.getAttribute('href');
            if (!id || id === '#') return;
            const target = document.querySelector(id);
            if (!target) return;
            e.preventDefault();
            target.scrollIntoView({
                behavior: reduceMotion ? 'auto' : 'smooth',
                block: 'start'
            });
        });
    });

    /* ---------- Reveal on scroll ----------
       Uses IntersectionObserver where available, plus a scroll/rAF fallback
       so reveals always fire (some headless/preview browsers swallow IO). */
    const revealEls = Array.from(document.querySelectorAll('[data-reveal]'));
    const reveal = (el) => el.classList.add('is-visible');
    let pending = new Set(revealEls);

    const checkVisible = () => {
        const vh = window.innerHeight || document.documentElement.clientHeight;
        // No real viewport (headless/preview browsers): reveal everything
        if (!vh) {
            pending.forEach(reveal);
            pending.clear();
            window.removeEventListener('scroll', onScrollReveal);
            window.removeEventListener('resize', onScrollReveal);
            return;
        }
        pending.forEach(el => {
            const r = el.getBoundingClientRect();
            const inView = r.top < vh - 60 && r.bottom > 0;
            if (inView) {
                reveal(el);
                pending.delete(el);
            }
        });
        if (!pending.size) {
            window.removeEventListener('scroll', onScrollReveal);
            window.removeEventListener('resize', onScrollReveal);
        }
    };

    let rafId = null;
    const onScrollReveal = () => {
        if (rafId) return;
        rafId = requestAnimationFrame(() => {
            rafId = null;
            checkVisible();
        });
    };

    if ('IntersectionObserver' in window && pending.size) {
        const io = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    reveal(entry.target);
                    pending.delete(entry.target);
                    io.unobserve(entry.target);
                }
            });
        }, { threshold: 0.15, rootMargin: '0px 0px -60px 0px' });

        revealEls.forEach(el => io.observe(el));
    }

    window.addEventListener('scroll', onScrollReveal, { passive: true });
    window.addEventListener('resize', onScrollReveal, { passive: true });
    // Initial check (and a delayed re-check in case fonts/images shift layout)
    checkVisible();
    setTimeout(checkVisible, 200);

    /* ---------- Active nav link ---------- */
    const sections = document.querySelectorAll('main section[id]');
    const navLinks = document.querySelectorAll('.nav-links a[href^="#"]');
    if (sections.length && navLinks.length && 'IntersectionObserver' in window) {
        const linkMap = new Map();
        navLinks.forEach(a => linkMap.set(a.getAttribute('href').slice(1), a));

        const activeIo = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    navLinks.forEach(a => a.classList.remove('active'));
                    const link = linkMap.get(entry.target.id);
                    link?.classList.add('active');
                }
            });
        }, { rootMargin: '-40% 0px -55% 0px', threshold: 0 });

        sections.forEach(s => activeIo.observe(s));
    }

    /* ---------- Stat count-up ---------- */
    const counters = document.querySelectorAll('[data-count]');
    if (counters.length && 'IntersectionObserver' in window && !reduceMotion) {
        const animate = (el) => {
            const target = parseFloat(el.dataset.count);
            const suffix = el.dataset.suffix || '';
            const duration = 1400;
            const start = performance.now();

            const tick = (now) => {
                const elapsed = now - start;
                const progress = Math.min(elapsed / duration, 1);
                // ease-out cubic
                const eased = 1 - Math.pow(1 - progress, 3);
                const value = target * eased;
                const display = Number.isInteger(target) ? Math.floor(value) : value.toFixed(1);
                el.textContent = display + suffix;
                if (progress < 1) requestAnimationFrame(tick);
                else el.textContent = target + suffix;
            };

            requestAnimationFrame(tick);
        };

        const countIo = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    animate(entry.target);
                    countIo.unobserve(entry.target);
                }
            });
        }, { threshold: 0.5 });

        counters.forEach(c => countIo.observe(c));
    } else if (reduceMotion) {
        counters.forEach(c => {
            c.textContent = c.dataset.count + (c.dataset.suffix || '');
        });
    }
})();
