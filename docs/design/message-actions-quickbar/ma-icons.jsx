// ma-icons.jsx — small stroked icon set (20x20), currentColor.
const MA_ICONS = (function () {
  const S = ({ children, size = 16, sw = 1.6, ...p }) => (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none"
      stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" {...p}>
      {children}
    </svg>
  );
  return {
    reply:   (p) => <S {...p}><path d="M8 5 3.5 9.5 8 14" /><path d="M3.5 9.5H12a4.5 4.5 0 0 1 4.5 4.5V15" /></S>,
    smiley:  (p) => <S {...p}><circle cx="10" cy="10" r="6.6" /><path d="M7.6 8.8h.01M12.4 8.8h.01" /><path d="M7.5 12.2a3.4 3.4 0 0 0 5 0" /></S>,
    bolt:    (p) => <S {...p}><path d="M11 2.5 4.5 11H9l-1 6.5L15.5 9H11z" /></S>,
    copy:    (p) => <S {...p}><rect x="7" y="7" width="9" height="9" rx="1.7" /><path d="M4 12.6V5.6A1.6 1.6 0 0 1 5.6 4H12" /></S>,
    key:     (p) => <S {...p}><circle cx="7" cy="9.4" r="3" /><path d="M9.4 8 16 4M14 5l1.4 1.4M16 4l1.4 1.4" transform="translate(-1 3)" /><path d="M9.3 10.6 15 16.3M13.2 14.5l1.6-1.6M14.8 16l1.6-1.6" /></S>,
    info:    (p) => <S {...p}><circle cx="10" cy="10" r="7" /><path d="M10 9.2v4M10 6.7h.01" /></S>,
    trash:   (p) => <S {...p}><path d="M4.5 6h11M8 6V4.7A1.2 1.2 0 0 1 9.2 3.5h1.6A1.2 1.2 0 0 1 12 4.7V6" /><path d="M6 6l.7 9.3A1.3 1.3 0 0 0 8 16.5h4a1.3 1.3 0 0 0 1.3-1.2L14 6" /></S>,
    more:    (p) => <S {...p}><circle cx="5" cy="10" r="1.15" fill="currentColor" stroke="none" /><circle cx="10" cy="10" r="1.15" fill="currentColor" stroke="none" /><circle cx="15" cy="10" r="1.15" fill="currentColor" stroke="none" /></S>,
    forward: (p) => <S {...p}><path d="M12 5l4.5 4.5L12 14" /><path d="M16.5 9.5H8a4.5 4.5 0 0 0-4.5 4.5V15" /></S>,
    pin:     (p) => <S {...p}><path d="M8.2 3h3.6l-.6 4 2.1 2.1-.9.9H7.6l-.9-.9L8.8 7z" /><path d="M10 12V17" /></S>,
    plus:    (p) => <S {...p}><path d="M10 4.2v11.6M4.2 10h11.6" /></S>,
    search:  (p) => <S {...p}><circle cx="9" cy="9" r="5" /><path d="M12.8 12.8 16.5 16.5" /></S>,
    chevron: (p) => <S {...p}><path d="M7.5 5 12.5 10l-5 5" /></S>,
    at:      (p) => <S {...p}><circle cx="10" cy="10" r="3" /><path d="M13 10v1.6a2.4 2.4 0 0 0 4.8 0V10a7.8 7.8 0 1 0-3 6.1" /></S>,
    back:    (p) => <S {...p}><path d="M11.5 5 6.5 10l5 5" /></S>,
  };
})();
window.MA_ICONS = MA_ICONS;
