import { createTheme } from "@mui/material/styles";
import { frFR } from "@mui/material/locale";

const colors = {
  primary: "#1D4ED8",
  primaryDark: "#1E40AF",
  primaryLight: "#DBEAFE",
  background: "#F8FAFC",
  paper: "#FFFFFF",
  text: "#0F172A",
  secondary: "#475569",
  divider: "#E2E8F0",
  control: "#64748B",
  success: "#166534",
  warning: "#92400E",
  error: "#B91C1C",
};

export const theme = createTheme(
  {
    palette: {
      mode: "light",
      primary: {
        main: colors.primary,
        dark: colors.primaryDark,
        light: colors.primaryLight,
        contrastText: colors.paper,
      },
      background: { default: colors.background, paper: colors.paper },
      text: { primary: colors.text, secondary: colors.secondary },
      divider: colors.divider,
      success: { main: colors.success },
      warning: { main: colors.warning },
      error: { main: colors.error },
      info: { main: colors.primary },
      action: {
        hover: colors.background,
        selected: colors.primaryLight,
        focus: colors.primaryLight,
        disabled: colors.secondary,
        disabledBackground: colors.divider,
      },
    },
    spacing: 8,
    shape: { borderRadius: 8 },
    breakpoints: { values: { xs: 0, sm: 600, md: 900, lg: 1200, xl: 1536 } },
    typography: {
      fontFamily:
        'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      h1: {
        fontSize: "1.75rem",
        lineHeight: 1.25,
        fontWeight: 600,
        "@media (max-width:599.95px)": { fontSize: "1.5rem" },
      },
      h2: { fontSize: "1.25rem", lineHeight: 1.4, fontWeight: 600 },
      h3: { fontSize: "1rem", lineHeight: 1.5, fontWeight: 600 },
      body1: { fontSize: "1rem", lineHeight: 1.5 },
      body2: { fontSize: "0.875rem", lineHeight: 1.5 },
      caption: { fontSize: "0.75rem", lineHeight: 1.5 },
      button: { fontWeight: 600, textTransform: "none" },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: { margin: 0, minWidth: 0, overflowWrap: "anywhere" },
          "*, *::before, *::after": { boxSizing: "border-box" },
          ":focus-visible": {
            outline: `2px solid ${colors.primary}`,
            outlineOffset: "2px",
          },
          "@media (prefers-reduced-motion: reduce)": {
            "*, *::before, *::after": {
              animation: "none !important",
              transition: "none !important",
              scrollBehavior: "auto !important",
            },
          },
        },
      },
      MuiPaper: { defaultProps: { elevation: 0 } },
      MuiCard: { defaultProps: { variant: "outlined" } },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            minHeight: 44,
            minWidth: 44,
            "&.Mui-focusVisible": {
              outline: `2px solid ${colors.primary}`,
              outlineOffset: 2,
              boxShadow: `0 0 0 2px ${colors.paper}`,
            },
          },
          outlined: { borderColor: colors.control },
        },
      },
      MuiIconButton: {
        styleOverrides: { root: { minWidth: 44, minHeight: 44 } },
      },
      MuiOutlinedInput: {
        styleOverrides: { notchedOutline: { borderColor: colors.control } },
      },
      MuiTableCell: {
        styleOverrides: { root: { fontVariantNumeric: "tabular-nums" } },
      },
      MuiAlert: {
        styleOverrides: {
          standard: {
            "&.MuiAlert-colorInfo": {
              color: colors.primary,
              backgroundColor: "#EFF6FF",
            },
            "&.MuiAlert-colorSuccess": {
              color: colors.success,
              backgroundColor: "#F0FDF4",
            },
            "&.MuiAlert-colorWarning": {
              color: colors.warning,
              backgroundColor: "#FFFBEB",
            },
            "&.MuiAlert-colorError": {
              color: colors.error,
              backgroundColor: "#FEF2F2",
            },
          },
        },
      },
    },
  },
  frFR,
);
