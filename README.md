# SOLFUN - MVP

Solfun est un mini-jeu web pour apprendre la lecture des notes (DO, RE, MI, FA, SOL) sur une portee en cle de sol.

## Stack

- HTML5
- CSS3
- JavaScript natif (ES Modules)
- SVG (rendu de la partition)
- Web Speech API (reconnaissance vocale)
- Web Audio API (son de reussite)

## Moteurs vocaux

Solfun propose deux moteurs de reconnaissance pour l'exercice continu:

- `Web Speech` (navigateur)
- `Vosk local (prototype)`

Le choix du moteur se fait sur l'ecran d'accueil.

## Prototype Vosk local

Le prototype Vosk utilise `vosk-browser` en WebAssembly charge depuis CDN, mais le modele acoustique doit etre present localement.

Chemin attendu du modele:

```text
assets/models/vosk-model-small-fr/model.tar.gz
```

Notes importantes:

- `model.tar.gz` doit contenir un modele Vosk compatible navigateur.
- Le chargement initial peut prendre plusieurs secondes.
- En cas d'absence du modele, Solfun affiche un message explicite et tu peux revenir a Web Speech.

## Lancer en local

1. Ouvrir un terminal dans le dossier du projet.
2. Lancer un serveur statique, par exemple :

```powershell
python -m http.server 5500
```

3. Ouvrir ensuite dans Chrome ou Edge :

```text
http://localhost:5500
```

Pour tester Vosk, verifie que le fichier `assets/models/vosk-model-small-fr/model.tar.gz` est bien present avant de lancer une partie.

Installation automatique (PowerShell):

```powershell
./scripts/install-vosk-model-fr.ps1
```

Le script telecharge un modele FR Vosk, prepare la structure `model/...` attendue par `vosk-browser` puis genere:

```text
assets/models/vosk-model-small-fr/model.tar.gz
```

## Parcours MVP

1. Cliquer sur "Jouer".
2. Observer la note affichee sur la portee.
3. Repondre au micro avec le nom de la note, ou utiliser les boutons DO/RE/MI/FA/SOL.
4. En cas de bonne reponse : point + animation + son + passage automatique a la note suivante.
5. En fin de partie (10 notes) : affichage du score final, bonnes reponses et pourcentage.

## Structure

- index.html
- css/style.css
- css/animations.css
- js/app.js
- js/game-engine.js
- js/note-generator.js
- js/score-renderer.js
- js/speech-recognition.js
- js/answer-validator.js
- js/game-ui.js
- assets/sounds/
- assets/images/
