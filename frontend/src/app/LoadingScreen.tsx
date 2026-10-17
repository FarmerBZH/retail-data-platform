import { Box, Skeleton, Stack, Typography } from "@mui/material";

export function LoadingScreen() {
  return (
    <Box component="main" sx={{ maxWidth: 640, mx: "auto", p: 3, pt: 6 }}>
      <Stack spacing={3} role="status" aria-live="polite" aria-busy="true">
        <Typography>Chargement de la plateforme…</Typography>
        <Skeleton aria-hidden="true" variant="rounded" height={180} />
      </Stack>
    </Box>
  );
}
