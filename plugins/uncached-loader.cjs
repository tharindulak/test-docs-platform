// A webpack loader that marks its module as never cacheable: partials/ files
// are compiled per Edition (markers, variables, links under the base URL),
// and builds of other Editions share the persistent cache.
module.exports = function uncached(source, map) {
  this.cacheable(false);
  this.callback(null, source, map);
};
