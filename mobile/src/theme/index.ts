// MidFood's look, in one place.
//
// "Highveld sunset": a deep plum sky with an ember-orange sun. The plum does
// the quiet work (headers, the tab bar, headings) so the food photos and the
// one hot colour do the shouting. Numbers and headlines are set in Fraunces,
// a soft serif that reads like a menu board; everything else is Poppins.
import { Platform, TextStyle } from 'react-native';

export const colors = {
  // The sun
  ember: '#FF5A2D',
  emberDeep: '#E8431C',
  emberSoft: '#FFE9E0',
  flameStart: '#FF7A3C',
  flameEnd: '#FF3D5E',
  // The sky
  plum: '#24122F',
  plumDeep: '#170A1F',
  plumSoft: '#3B2249',
  // The table
  paper: '#FFF7F0',
  surface: '#FFFFFF',
  sand: '#F6E9DE',
  sandDeep: '#EBD9C8',
  line: 'rgba(36, 18, 47, 0.10)',
  lineStrong: 'rgba(36, 18, 47, 0.18)',
  // Ink
  ink: '#1C1020',
  inkSoft: 'rgba(28, 16, 32, 0.62)',
  inkFaint: 'rgba(28, 16, 32, 0.42)',
  onDark: '#FFFFFF',
  onDarkSoft: 'rgba(255, 255, 255, 0.72)',
  // Signals
  mint: '#16A86B',
  mintSoft: '#DDF5EA',
  mango: '#FFB020',
  mangoSoft: '#FFF1D6',
  berry: '#D9256B',
  berrySoft: '#FBE0EB',
  sky: '#2F7DE1',
  skySoft: '#E0ECFB',
  whatsapp: '#25D366',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };

// Radii carry hierarchy: big surfaces are rounder than the controls on them.
export const radius = { xs: 6, sm: 10, md: 14, lg: 20, xl: 28, pill: 999 };

export const fonts = {
  display: 'Fraunces-ExtraBold',
  displaySemi: 'Fraunces-SemiBold',
  regular: 'Poppins-Regular',
  medium: 'Poppins-Medium',
  bold: 'Poppins-Bold',
  black: 'Poppins-ExtraBold',
};

// The type scale. Display sizes use Fraunces; the rest Poppins.
export const type: Record<string, TextStyle> = {
  hero: { fontFamily: fonts.display, fontSize: 34, lineHeight: 38, letterSpacing: -0.5, color: colors.ink },
  title: { fontFamily: fonts.display, fontSize: 26, lineHeight: 30, letterSpacing: -0.3, color: colors.ink },
  heading: { fontFamily: fonts.display, fontSize: 21, lineHeight: 26, color: colors.ink },
  subheading: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 22, color: colors.ink },
  body: { fontFamily: fonts.regular, fontSize: 14.5, lineHeight: 21, color: colors.ink },
  bodyMedium: { fontFamily: fonts.medium, fontSize: 14.5, lineHeight: 21, color: colors.ink },
  small: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, color: colors.inkSoft },
  smallBold: { fontFamily: fonts.bold, fontSize: 12.5, lineHeight: 18, color: colors.ink },
  label: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 18, color: colors.inkSoft },
  button: { fontFamily: fonts.bold, fontSize: 15.5, lineHeight: 20, color: colors.onDark },
  price: { fontFamily: fonts.display, fontSize: 18, lineHeight: 22, color: colors.ink },
  priceBig: { fontFamily: fonts.display, fontSize: 28, lineHeight: 32, color: colors.ink },
};

export const shadow = {
  card: Platform.select({
    ios: { shadowColor: colors.plum, shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
    android: { elevation: 2 },
    default: {},
  }) as object,
  float: Platform.select({
    ios: { shadowColor: colors.plum, shadowOpacity: 0.22, shadowRadius: 20, shadowOffset: { width: 0, height: 10 } },
    android: { elevation: 8 },
    default: {},
  }) as object,
  ember: Platform.select({
    ios: { shadowColor: colors.ember, shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } },
    android: { elevation: 6 },
    default: {},
  }) as object,
};

export const flame = [colors.flameStart, colors.flameEnd] as const;
export const night = [colors.plumSoft, colors.plum, colors.plumDeep] as const;

// A kitchen's own colour, made usable as a soft tint behind its initial.
export function tint(hex: string | undefined | null, alpha = 0.18) {
  const h = (hex || colors.ember).replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  if (Number.isNaN(n)) return `rgba(255,90,45,${alpha})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export function rands(n: number) {
  return Number.isInteger(n) ? `R${n}` : `R${n.toFixed(2)}`;
}
