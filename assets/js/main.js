/* Stylus AI landing page — behaviour.
   Plain ES5-compatible DOM code: no dependencies, no build step. */
(function () {
  'use strict';

  /* ----------------------------------------------------------------- pwa ---
     sw.js sits next to index.html, while this file is served from assets/js/.
     currentScript resolves that relationship once, so the registration is
     correct on /pl/index.html and under a sub-path as well. */
  var SITE_BASE = (function () {
    var script = document.currentScript;
    if (!script || !script.src) { return './'; }
    return script.src.replace(/assets\/js\/main\.js(\?.*)?$/, '');
  }());

  /* ---------------------------------------------------------------- nav --- */
  var toggle = document.querySelector('[data-nav-toggle]');
  var menu = document.querySelector('[data-nav-menu]');

  if (toggle && menu) {
    var setNav = function (open) {
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      menu.classList.toggle('is-open', open);
    };

    toggle.addEventListener('click', function () {
      setNav(toggle.getAttribute('aria-expanded') !== 'true');
    });

    menu.addEventListener('click', function (event) {
      if (event.target.closest && event.target.closest('a')) { setNav(false); }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
        setNav(false);
        toggle.focus();
      }
    });

    window.addEventListener('resize', function () {
      if (window.innerWidth > 860) { setNav(false); }
    });
  }

  /* ------------------------------------------------------- nav dropdown ---
     The section links sit in a <details>, which opens natively. This closes
     the panel again: after a link is picked (the page only scrolls, so the open
     panel would otherwise follow the reader down the page), on Escape, on a
     click outside, and when the layout crosses the 860px boundary between the
     desktop dropdown and the mobile hamburger. */
  var navPicker = document.querySelector('.nav-picker');

  if (navPicker) {
    var navSummary = navPicker.querySelector('summary');
    var pickerWide = window.innerWidth > 860;
    var closePicker = function () { navPicker.open = false; };

    navPicker.addEventListener('click', function (event) {
      if (event.target.closest && event.target.closest('a')) { closePicker(); }
    });

    document.addEventListener('click', function (event) {
      if (navPicker.open && !navPicker.contains(event.target)) { closePicker(); }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && navPicker.open) {
        closePicker();
        if (navSummary) { navSummary.focus(); }
      }
    });

    window.addEventListener('resize', function () {
      var wide = window.innerWidth > 860;
      if (wide !== pickerWide) { pickerWide = wide; closePicker(); }
    });
  }

  /* ------------------------------------------- one dropdown at a time ---
     Both header dropdowns are native <details>, so nothing stops a reader
     from opening the language panel and then the section panel: the two
     panels are absolutely positioned in the same band under the navbar and
     would be drawn on top of each other. Opening one closes the other. */
  var pickers = document.querySelectorAll('.nav-picker, .lang-picker');

  if (pickers.length > 1) {
    var closeOtherPickers = function (current) {
      Array.prototype.forEach.call(pickers, function (other) {
        if (other !== current && other.open) { other.open = false; }
      });
    };

    Array.prototype.forEach.call(pickers, function (picker) {
      picker.addEventListener('toggle', function () {
        if (picker.open) { closeOtherPickers(picker); }
      });
    });
  }

  /* ------------------------------------------------------------- slider --- */
  var slider = document.querySelector('[data-slider]');

  if (slider) {
    var track = slider.querySelector('[data-slider-track]');
    var viewport = slider.querySelector('.slider__viewport');
    var slides = track ? Array.prototype.slice.call(track.children) : [];
    var prevBtn = slider.querySelector('[data-slider-prev]');
    var nextBtn = slider.querySelector('[data-slider-next]');
    var dotBox = slider.querySelector('[data-slider-dots]');
    var index = 0;
    var dots = [];

    var perView = function () {
      if (!slides.length) { return 1; }
      var slideW = slides[0].getBoundingClientRect().width;
      var viewW = viewport.getBoundingClientRect().width;
      if (!slideW) { return 1; }
      return Math.max(1, Math.round(viewW / slideW));
    };

    var maxIndex = function () {
      return Math.max(0, slides.length - perView());
    };

    /* The Arabic page sets dir="rtl" on <html>. An RTL flex track starts at the
       right edge, so the same logical index has to translate to the right
       instead of the left; the arrows and the swipe direction follow from it. */
    var rtl = function () { return document.documentElement.dir === 'rtl'; };

    var paint = function () {
      var step = slides.length ? slides[0].getBoundingClientRect().width : 0;
      var offset = index * step * (rtl() ? 1 : -1);
      track.style.transform = 'translate3d(' + offset + 'px,0,0)';

      var last = maxIndex();
      if (prevBtn) { prevBtn.disabled = index <= 0; }
      if (nextBtn) { nextBtn.disabled = index >= last; }

      var pv = perView();
      var page = pv ? Math.round(index / pv) : 0;
      for (var i = 0; i < dots.length; i++) {
        dots[i].setAttribute('aria-current', i === page ? 'true' : 'false');
      }
    };

    var goTo = function (target) {
      index = Math.min(Math.max(target, 0), maxIndex());
      paint();
    };

    var buildDots = function () {
      if (!dotBox) { return; }
      dotBox.textContent = '';
      dots = [];

      var pages = Math.ceil(slides.length / perView());
      if (pages < 2) { return; }

      /* The label comes from the markup so the Polish page can carry its own
         wording without any language sniffing in here. */
      var labelTemplate = dotBox.getAttribute('data-label') || 'Show reviews page {n}';

      for (var i = 0; i < pages; i++) {
        (function (pageIndex) {
          var dot = document.createElement('button');
          dot.type = 'button';
          dot.className = 'slider__dot';
          dot.setAttribute('aria-label', labelTemplate.replace('{n}', String(pageIndex + 1)));
          dot.addEventListener('click', function () { goTo(pageIndex * perView()); });
          dotBox.appendChild(dot);
          dots.push(dot);
        }(i));
      }
    };

    var refresh = function () {
      index = Math.round(index / perView()) * perView();
      index = Math.min(index, maxIndex());
      buildDots();
      paint();
    };

    if (prevBtn) { prevBtn.addEventListener('click', function () { goTo(index - perView()); }); }
    if (nextBtn) { nextBtn.addEventListener('click', function () { goTo(index + perView()); }); }

    slider.addEventListener('keydown', function (event) {
      /* ArrowLeft always means "towards the start of the list", which in RTL is
         the arrow that points right on screen. */
      var back = rtl() ? 'ArrowRight' : 'ArrowLeft';
      var fwd = rtl() ? 'ArrowLeft' : 'ArrowRight';
      if (event.key === back) { event.preventDefault(); goTo(index - perView()); }
      if (event.key === fwd) { event.preventDefault(); goTo(index + perView()); }
    });

    /* swipe / drag */
    var startX = 0, startY = 0, tracking = false;
    viewport.addEventListener('pointerdown', function (event) {
      if (event.pointerType === 'mouse') { return; }
      tracking = true;
      startX = event.clientX;
      startY = event.clientY;
    });
    viewport.addEventListener('pointerup', function (event) {
      if (!tracking) { return; }
      tracking = false;
      var dx = event.clientX - startX;
      var dy = event.clientY - startY;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
        goTo((dx < 0) !== rtl() ? index + perView() : index - perView());
      }
    });
    viewport.addEventListener('pointercancel', function () { tracking = false; });

    var resizeTimer = null;
    window.addEventListener('resize', function () {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(refresh, 150);
    });

    refresh();
  }

  /* -------------------------------------------------------------- reveal --- */
  var reveals = document.querySelectorAll('.reveal');

  if (reveals.length) {
    if ('IntersectionObserver' in window) {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

      Array.prototype.forEach.call(reveals, function (element) { observer.observe(element); });
    } else {
      Array.prototype.forEach.call(reveals, function (element) { element.classList.add('is-visible'); });
    }
  }

  /* ------------------------------------------------------------ offline --- */
  /* Registration is deferred to the load event so the worker never competes
     with the hero image for bandwidth. A failure here is not fatal: the site
     keeps working exactly as before, just without the offline cache. */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register(SITE_BASE + 'sw.js').catch(function () {});
    });
  }

  /* ---------------------------------------------------------------- year --- */
  var yearNodes = document.querySelectorAll('[data-year]');
  Array.prototype.forEach.call(yearNodes, function (node) {
    node.textContent = String(new Date().getFullYear());
  });
}());
