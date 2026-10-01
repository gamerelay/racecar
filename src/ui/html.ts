/** Text made safe for innerHTML: names and plates come from other players. */
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
