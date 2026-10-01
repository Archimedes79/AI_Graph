/** @typedef {Object} Output
 * @property {string} output The generated LaTeX document source code.
 */
module.exports = {
  "output": "\\documentclass{article}\n\\usepackage[utf8]{inputenc}\n\\usepackage[ngerman]{babel}\n\\usepackage{booktabs}\n\n\\title{Messung der Bodenfeuchte in Kleingärt{}en}\n\\author{Erika Mustermann, Beispielinstitut}\n\\date{}\n\n\\begin{document}\n\n\\maketitle\n\n\\section{Einleitung}\n\nKleingärt{}en verbrauchen im Sommer viel Trinkwasser. Diese \\textit{fiktive} Studie prüft, ob ein Sensor den Verbrauch um mindestens 30 \\% senkt -- bei gleichem Ertrag.\n\nWir vergleichen zwei Verfahren:\n\n\\begin{itemize}\n\\item feste tägliche Bewässerung,\n\\item Bewässerung nur unterhalb eines Schwellwerts \\( \\theta = 0{,}25 \\).\n\\end{itemize}\n\n\\end{document}"
};
