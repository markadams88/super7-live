/* List every week's pack here. Add a line when a new week is built. */
(function(){
  var packs = ['week01', 'week02', 'week03', 'week04', 'week05', 'week06', 'week07', 'week08', 'week09', 'week10', 'week11', 'week12', 'week13'];
  packs.forEach(function(p){ document.write('<script src="packs/'+p+'.js"><\/script>'); });
})();
