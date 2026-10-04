// Astro 7.3.5's assets/build/remote.js uses only these two policy methods.
// Never grant a cache lifetime. Every remote image must be revalidated.
module.exports = class NoHttpCachePolicy {
  storable() { return false; }
  timeToLive() { return 0; }
};
