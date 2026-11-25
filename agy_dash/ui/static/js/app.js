// Browser behavior for the local usage dashboard.
(function() {
  'use strict';

  const chartObservers = new WeakMap();
  const compactNumber = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

  function initCharts(root = document) {
    if (typeof echarts === 'undefined') return;
    const containers = root.querySelectorAll('[data-chart]');
    containers.forEach(el => {
      if (echarts.getInstanceByDom(el)) return;
      const scriptId = el.getAttribute('data-chart');
      const script = document.getElementById(scriptId);
      if (!script) return;
      try {
        const option = JSON.parse(script.textContent);
        for (const axis of [option.xAxis, option.yAxis].flat().filter(Boolean)) {
          axis.axisLabel = { color: option.textStyle.color, hideOverlap: true, ...axis.axisLabel };
          if (axis.type === 'value') axis.axisLabel.formatter ??= value => compactNumber.format(value);
        }
        const chart = echarts.init(el, null, { renderer: 'canvas' });
        chart.setOption(option, true);

        if (typeof ResizeObserver !== 'undefined') {
          const ro = new ResizeObserver(() => chart.resize());
          ro.observe(el);
          chartObservers.set(el, ro);
        }
      } catch (err) {
        console.error('Failed to parse or render chart option for', scriptId, err);
      }
    });
  }

  if (typeof ResizeObserver === 'undefined') {
    window.addEventListener('resize', () => {
      document.querySelectorAll('[data-chart]').forEach(el => {
        window.echarts?.getInstanceByDom(el)?.resize();
      });
    });
  }

  document.addEventListener('htmx:beforeCleanupElement', ({ detail }) => {
    const el = detail.elt;
    if (!(el instanceof Element) || !el.matches('[data-chart]')) return;
    chartObservers.get(el)?.disconnect();
    chartObservers.delete(el);
    window.echarts?.getInstanceByDom(el)?.dispose();
  });

  window.openDrawer = function(id) {
    const drawer = document.getElementById(id);
    if (drawer && !drawer.open) drawer.showModal();
  };

  window.closeDrawers = function() {
    document.querySelector('.drawer[open]')?.close();
  };

  document.addEventListener('click', event => {
    const drawer = event.target;
    if (!(drawer instanceof HTMLDialogElement) || !drawer.matches('.drawer[open]')) return;
    const rect = drawer.getBoundingClientRect();
    if (event.clientX < rect.left) drawer.close();
  });

  window.toggleTheme = function() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('agy_theme', next);
    document.cookie = `agy_theme=${next}; path=/; max-age=31536000`;
    const themeInput = document.getElementById('global-theme-input');
    if (themeInput) themeInput.value = next;
    const form = document.getElementById('global-filter-form');
    if (form) form.requestSubmit();
  };

  function syncActiveTab() {
    const view = document.getElementById('workspace-canvas')?.dataset.view;
    if (!view) return;
    document.querySelectorAll('.nav-tab').forEach(tab => {
      const active = tab.dataset.view === view;
      tab.classList.toggle('active', active);
      if (active) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    });
    const viewInput = document.getElementById('global-view-input');
    if (viewInput) {
      viewInput.value = view;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    initCharts();
    syncActiveTab();
  });

  document.addEventListener('htmx:afterSwap', (evt) => {
    const target = evt.detail.target;
    if (target) {
      const root = document.contains(target) ? target : document;
      requestAnimationFrame(() => initCharts(root));
      syncActiveTab();
    }
  });

  document.addEventListener('htmx:historyRestore', () => {
    requestAnimationFrame(() => initCharts());
    syncActiveTab();
  });
})();
