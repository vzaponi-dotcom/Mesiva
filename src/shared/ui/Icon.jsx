const icons = {
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
  clipboard: <><rect x="5" y="5" width="14" height="16" rx="2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></>,
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
  orders: <><path d="M6 3h12a2 2 0 0 1 2 2v16l-3-2-3 2-3-2-3 2-3-2-1 1V5a2 2 0 0 1 2-2Z"/><path d="M8 8h8M8 12h6"/></>,
  clients: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
  building: <><path d="M7 21V3h10v18M3 21h18M3 21V9h4M21 21V9h-4M10 7h.01M14 7h.01M10 11h.01M14 11h.01M10 15h.01M14 15h.01M10 21v-3h4v3"/></>,
  history: <><path d="M3 11a9 9 0 1 1 2.6 7.4M3 4v7h7"/><path d="M12 7v5l3 2"/></>,
  tags: <><path d="m20 13-7 7a2 2 0 0 1-3 0l-8-8V4h8l10 6a2 2 0 0 1 0 3Z"/><circle cx="6.5" cy="8" r=".8"/><path d="M14 3h3l5 5v4"/></>,
  laptop: <><rect x="5" y="3" width="14" height="12" rx="2"/><path d="m5 15-3 5h20l-3-5M9 17h6"/></>,
  products: <><path d="m21 8-9 5-9-5 9-5 9 5Z"/><path d="m3 8 9 5 9-5M3 12l9 5 9-5M3 16l9 5 9-5"/></>,
  finance: <><path d="M3 6h18v12H3z"/><path d="M7 10h4M7 14h2M15 12h2"/></>,
  pix: <><path d="m12 3 4.5 4.5L12 12 7.5 7.5 12 3Z"/><path d="m16.5 7.5 4.5 4.5-4.5 4.5L12 12l4.5-4.5ZM7.5 7.5 12 12l-4.5 4.5L3 12l4.5-4.5ZM12 12l4.5 4.5L12 21l-4.5-4.5L12 12Z"/></>,
  cash: <><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9h.01M18 15h.01"/></>,
  card: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/></>,
  transfer: <><path d="M4 8h14M15 5l3 3-3 3M20 16H6M9 13l-3 3 3 3"/></>,
  chart: <><path d="M4 20V11M10 20V5M16 20v-7"/><path d="M2 20h20"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
  filter: <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="17" r="2"/></>,
  edit: <><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"/></>,
  trash: <><path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 11v5M14 11v5"/></>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 10h18c0-2-3-3-3-10Z"/><path d="M10 21h4"/></>,
  logout: <><path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5"/><path d="M13 16l4-4-4-4M8 12h9"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  shield: <path d="M12 3 19 6v5c0 4.6-2.9 8-7 10-4.1-2-7-5.4-7-10V6Z"/>,
  wallet: <><path d="M4 6h14a2 2 0 0 1 2 2v10H4a2 2 0 0 1-2-2V6a3 3 0 0 1 3-3h11"/><path d="M20 11h-5a2 2 0 0 0 0 4h5"/></>,
  receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z"/><path d="M9 8h6M9 12h6"/></>,
  flame: <><path d="M12 22a7 7 0 0 0 7-7c0-3.2-1.8-6-5-8 .3 2-1 3.8-2.7 4.8.2-3.2-1.2-6.3-4.3-8.8.4 3-1.5 5.3-3 7.5A8 8 0 0 0 3 15a7 7 0 0 0 9 7Z"/><path d="M12 22c-2.2-.7-3.5-2.2-3.5-4.2 0-1.7 1.1-3.2 2.6-4.7.1 1.5.8 2.5 1.7 3.2.7-.7 1.2-1.7 1.1-2.8 1.6 1.4 2.7 2.8 2.7 4.6 0 1.8-1.2 3.2-3.1 3.9"/></>,
  droplet: <path d="M12 2s6 6.7 6 12a6 6 0 0 1-12 0c0-5.3 6-12 6-12Z"/>,
  bolt: <path d="M13 2 5 14h7l-1 8 8-12h-7l1-8Z"/>,
  home: <><path d="m3 11 9-8 9 8"/><path d="M5 10v11h14V10M9 21v-7h6v7"/></>,
  wrench: <><path d="M14 7a4 4 0 0 0-5-4l2 2-3 3-2-2a4 4 0 0 0 4 5l8 8a2 2 0 1 0 3-3l-8-8"/><circle cx="19" cy="18" r=".7"/></>,
  percent: <><path d="m19 5-14 14"/><circle cx="7" cy="7" r="2"/><circle cx="17" cy="17" r="2"/></>,
  ticket: <><path d="M3 7h18v4a2 2 0 0 0 0 4v2H3v-2a2 2 0 0 0 0-4Z"/><path d="M13 7v10"/></>,
  package: <><path d="m21 8-9 5-9-5 9-5 9 5Z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/></>,
  meal: <><path d="M4 3v8M7 3v8M4 7h3M5.5 11v10"/><path d="M15 3v18M15 3c3 1 4 4 4 7h-4"/></>,
  snack: <><path d="M4 13h16M5 13c0-4 3-7 7-7s7 3 7 7M6 17h12"/><path d="M8 10h.01M12 9h.01M16 10h.01"/></>,
  combo: <><path d="M4 14h10M5 10h8M6 6h6"/><path d="M17 6h3l-1 15h-5l-.4-6"/></>,
  portion: <><path d="M4 10h16l-2 9H6Z"/><path d="M8 10c0-3 2-5 4-5s4 2 4 5"/></>,
  drink: <><path d="M6 4h12l-1 17H7Z"/><path d="M9 8h6M15 4l2-2"/></>,
  dessert: <><path d="M5 10h14l-2 9H7Z"/><path d="M8 10c0-3 2-5 4-5s4 2 4 5M12 5l2-2"/></>,
  sauce: <><path d="M9 3h6l1 4-1 14H9L8 7Z"/><path d="M8 7h8M10 12h4"/></>,
  eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
  'eye-off': <><path d="m3 3 18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a15.5 15.5 0 0 1-2.1 3.1M6.6 6.6C3.7 8.4 2 12 2 12s3.5 7 10 7c1.6 0 3-.4 4.2-1"/></>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></>,
  moon: <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/>,
  system: <><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></>,
  windows: <><path d="M3 5.5 10.5 4v7H3ZM12.5 3.6 21 2v9h-8.5ZM3 13h7.5v7L3 18.5ZM12.5 13H21v9l-8.5-1.6Z"/></>,
  android: <><path d="M7 8h10a2 2 0 0 1 2 2v7H5v-7a2 2 0 0 1 2-2ZM8 8 6.5 5.5M16 8l1.5-2.5"/><circle cx="9" cy="11" r=".6"/><circle cx="15" cy="11" r=".6"/><path d="M7 17v4M17 17v4M3 10v6M21 10v6"/></>,
  apple: <><path d="M15.8 5.2c-.8.9-2 1.5-3.1 1.4-.2-1.1.4-2.3 1.1-3 .8-.8 2-1.4 3-1.5.1 1.1-.3 2.2-1 3.1Z"/><path d="M18.4 12.7c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-2-1-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.8 1.3 10.3.9 1.2 1.9 2.6 3.2 2.5 1.3 0 1.8-.8 3.4-.8s2.1.8 3.5.8c1.4 0 2.3-1.2 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9-.1 0-3.2-1.2-3.2-4.4Z"/></>,
  'arrow-up': <path d="m7 14 5-5 5 5M12 9v10"/>,
  'arrow-down': <path d="m7 10 5 5 5-5M12 5v10"/>,
  download: <><path d="M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4"/></>,
  'arrow-right': <path d="m9 6 6 6-6 6"/>,
  'arrow-left': <path d="m15 6-6 6 6 6"/>,
  menu: <path d="M4 7h16M4 12h16M4 17h16"/>,
  more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  kitchen: <><path d="M4 4h16v16H4Z"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
  preparation: <><path d="M5 4h14v16H5Z"/><path d="M8 8h8M8 12h5M8 16h8"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  alert: <><path d="m12 3 9 18H3Z"/><path d="M12 9v5M12 17h.01"/></>,
  client: <><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3-6 8-6s8 2 8 6"/></>,
  phone: <><path d="M5 4h4l2 5-2.5 1.5a15 15 0 0 0 5 5L15 13l5 2v4c0 1.1-.9 2-2 2C10.3 21 3 13.7 3 6c0-1.1.9-2 2-2Z"/></>,
  delivery: <><path d="M3 6h11v12H3Z"/><path d="M14 10h4l3 3v5h-7Z"/><circle cx="7" cy="19" r="2"/><circle cx="18" cy="19" r="2"/></>,
  pickup: <><path d="M4 9h16v11H4Z"/><path d="M6 9 8 4h8l2 5M8 13h8"/></>,
  local: <><path d="M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/></>,
  table: <><path d="M4 8h16v4H4Z"/><path d="M7 12v9M17 12v9"/></>,
  note: <><path d="M5 3h14v18H5Z"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
  details: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></>,
  printer: <><path d="M6 9V3h12v6M6 17H3V9h18v8h-3"/><path d="M6 14h12v7H6Z"/></>,
  settings: <><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></>,
  'volume-on': <><path d="M4 10h4l5-4v12l-5-4H4Z"/><path d="M16 9c2 2 2 4 0 6M19 6c4 4 4 8 0 12"/></>,
  'volume-off': <><path d="m4 4 16 16M4 10h4l5-4v5M13 15v3l-5-4H4"/></>,
  cancel: <><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/></>,
  'chef-hat': <><path d="M6.5 10.5a3.7 3.7 0 0 1 1.7-6.9A4.8 4.8 0 0 1 16.8 5a3.6 3.6 0 0 1 1.2 6.9V19H6.5Z"/><path d="M6.5 15.2H18M9.5 15.2V19M15 15.2V19"/></>,
  'delivery-bike': <><circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/><path d="M6 18h5l3-7h3l2 4M10 18l-3-8h4M14 11l-2-3h-2"/></>,
}

function Icon({ name, size = 20, className = '' }) {
  const content = icons[name] ?? icons.dashboard

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {content}
    </svg>
  )
}

export default Icon
