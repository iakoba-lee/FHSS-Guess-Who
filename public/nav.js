(function () {
    function getCurrentPage() {
        const path = window.location.pathname;
        if (path === '/host' || path.endsWith('/host.html')) return 'host';

        const params = new URLSearchParams(window.location.search);
        if (params.get('practice') === '1') return 'practice';
        if (params.get('join') === '1' || params.get('code')) return 'join';

        const visibleView = document.querySelector('.glass-panel:not(.hidden)');
        if (visibleView) {
            if (visibleView.id === 'view-lobby') return 'join';
            if (visibleView.id === 'view-practice') return 'practice';
        }

        return 'home';
    }

    function removeLegacyNav() {
        document.getElementById('site-nav')?.remove();
        document.getElementById('nav-overlay')?.remove();
        document.body.classList.remove('nav-open');
    }

    function updateActiveLinks() {
        removeLegacyNav();
        const current = getCurrentPage();
        document.querySelectorAll('#site-menu a').forEach(link => {
            link.classList.toggle('active', link.dataset.page === current);
        });
    }

    window.fhssNav = { updateActiveLinks };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', updateActiveLinks);
    } else {
        updateActiveLinks();
    }
})();
