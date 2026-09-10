/* List every week's pack here. Add a line when a new week is built. */
(function(){
  var packs = ['week01'];
  packs.forEach(function(p){ document.write('<script src="packs/'+p+'.js"><\/script>'); });
})();
