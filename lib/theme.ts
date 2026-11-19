import { Platform, StyleSheet } from 'react-native';

export const colors = {
  emerald: '#047857',
  emeraldDark: '#065F46',
  emeraldLight: '#D1FAE5',
  teal: '#0F766E',
  amber: '#FBBF24',
  slate: '#1E293B',
  slateDark: '#0F172A',
  slateMedium: '#475569',
  slateLight: '#94A3B8',
  surface: '#FFFFFF',
  background: '#F1F5F9',
  border: '#CBD5E1',
  danger: '#B91C1C',
  dangerLight: '#FEE2E2',
  success: '#15803D',
  successLight: '#DCFCE7',
  overlay: 'rgba(15, 23, 42, 0.58)',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  xxl: 32,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
  xl: 24,
  pill: 999,
};

export const shadows = StyleSheet.create({
  card: {
    ...Platform.select({
      android: { elevation: 3 },
      default: {
        shadowColor: colors.slateDark,
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.12,
        shadowRadius: 8,
      },
    }),
  },
  soft: {
    ...Platform.select({
      android: { elevation: 1 },
      default: {
        shadowColor: colors.slateDark,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
      },
    }),
  },
});

export const typography = {
  brand: { fontSize: 30, fontWeight: '700' as const, letterSpacing: -0.8, color: colors.slateDark },
  h1: { fontSize: 24, fontWeight: '700' as const, color: colors.slateDark },
  h2: { fontSize: 19, fontWeight: '700' as const, color: colors.slateDark },
  body: { fontSize: 15, lineHeight: 22, color: colors.slate },
  caption: { fontSize: 12, lineHeight: 17, color: colors.slateMedium },
  label: { fontSize: 13, fontWeight: '600' as const, color: colors.slate },
};
