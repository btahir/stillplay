// Stillplay on ShipTiffin. Pushes to main deploy: the box builds the site from this repo.
// The build renders Open Graph images and prerenders every route in headless Chromium,
// so it installs the Playwright shell first. After an edit: tiffin plan, then tiffin apply.
export default {
  project: "stillplay",
  apps: {
    site: {
      framework: "static",
      routes: ["stillplay"],
      git: { repo: "btahir/stillplay", branch: "main", previews: "off" },
      build: "pnpm exec playwright install --with-deps --only-shell chromium && SITE_URL=https://stillplay.shiptiffin.app node scripts/build.mjs --no-cores",
      output: "dist",
      // Only changes to the game and its build deploy; docs, notes and tests don't.
      watch: ["src/**", "public/**", "scripts/**", "cores/**", "index.html", "package.json", "pnpm-lock.yaml"],
    },
  },
};
