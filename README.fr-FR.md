<div align="center">

# do-code

**Agent de programmation open source.**

Lisez du code, modifiez des fichiers, exécutez des commandes et vérifiez les résultats dans votre terminal et votre espace de travail.

[![CI](https://github.com/tree201/do-code/actions/workflows/ci.yml/badge.svg)](https://github.com/tree201/do-code/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-20.19%2B%20%7C%2022.12%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

[English](README.md) | [中文](README.zh-CN.md) | [日本語](README.ja-JP.md) | [한국어](README.ko-KR.md) | [Español](README.es-ES.md) | [Français](README.fr-FR.md)

[Démarrage rapide](#installation) · [Documentation](docs/README.md) · [Contribuer](CONTRIBUTING.md) · [Sécurité](SECURITY.md)

</div>

<p align="center">
  <img src="assets/terminal-preview.png" alt="aperçu du terminal de do-code" width="100%">
</p>

---

## Installation

Node.js `20.19+` ou `22.12+` est requis.

Exécution depuis les sources :

```bash
git clone https://github.com/tree201/do-code.git
cd do-code
npm install
npm run build:agent
npm link
```

Lancez ensuite do-code dans un projet existant :

```bash
cd /path/to/your-project
do-code auth
do-code
```

`do-code auth` vous guide dans la configuration du fournisseur. Les clés API sont stockées uniquement dans la configuration utilisateur locale ; les variables d’environnement remplacent les valeurs enregistrées.

> [!NOTE]
> Installez le paquet npm avec `npm install -g @tree201/do-code`. Lors de la première utilisation, démarrez dans un dépôt Git et utilisez le mode d’autorisation par défaut.

## Ce qu’il fait

- **Fonctionne dans de vrais dépôts** — lit et joint des fichiers, modifie du code, exécute des commandes shell, inspecte les différences Git et lance les tests.
- **Utilise votre fournisseur de modèles** — configuration intégrée pour Volcengine Ark, Alibaba ModelStudio, DeepSeek, MiniMax, Z.AI et ModelScope ; Custom Provider prend en charge les API compatibles avec OpenAI, Anthropic et Gemini.
- **Garde l’exécution sous contrôle** — les modes de planification et d’autorisation sont indépendants, et les modifications de fichiers et correctifs intégrés reçoivent des points de contrôle locaux pour inspection ou récupération.

Saisissez `/` pour parcourir les commandes et `@` pour joindre des fichiers de l’espace de travail :

```text
/plan · /permissions · /model · /resume
/status · /stats · /compact · /diff
/memory · /rewind · /export · /language
@src/app.ts           Ajouter un fichier au contexte actuel
!npm test             Exécuter une commande avec le mode d’autorisation actuel
```

Utilisez `/thinking` et `/effort` pour ajuster le raisonnement pendant une session ; ajoutez `--persist` pour enregistrer ce choix comme valeur par défaut pour les sessions futures. L’interface prend en charge l’anglais, le chinois simplifié, le japonais, le coréen, l’espagnol et le français via `--language` ou `/language`.

## Exécutez-le comme vous le souhaitez

### Terminal interactif

```bash
do-code
do-code --continue
do-code resume <session-id>
```

### Sessions et contexte

Continuez la dernière session du projet avec `do-code --continue`, ou choisissez-en une avec `resume` et `/resume` :

```bash
do-code sessions list
do-code sessions search "authentication"
do-code sessions rename <session-id> "Auth cleanup"
do-code sessions delete <session-id>
do-code sessions export <session-id> md ./session.md
```

Utilisez `/stats` pour inspecter l’utilisation du contexte et `/compact` pour le compacter à la demande. À l’approche de la limite de contexte, do-code compacte automatiquement tout en conservant les chemins, commandes, décisions et l’état de vérification importants.

### Instructions du projet et isolation

Les instructions `AGENTS.md` en couches suivent la hiérarchie de l’espace de travail ; inspectez-les ou rechargez-les avec `/memory`. Démarrez un Git worktree isolé avec `do-code --worktree` ou `do-code --worktree=<name>`, et inspectez les worktrees de do-code avec `do-code worktrees`.

### Profils et extensions

Les profils d’agent peuvent sélectionner un modèle, un mode d’approbation, des instructions, une limite d’étapes et des listes d’outils autorisés/interdits. Inspectez-les avec `do-code agents` et sélectionnez-en un avec `do-code --agent <name>`. Parcourez les commandes et compétences Markdown avec `/extensions` ; utilisez `do-code extensions` pour obtenir un résumé des commandes, compétences et serveurs MCP configurés.

### Scripts et CI

`run` produit une sortie JSON ou JSONL stable pour l’automatisation. Les tâches peuvent provenir d’un argument ou de `--task-file` ; `--max-steps` et `--timeout` définissent les budgets d’exécution. `--artifact-dir` enregistre la configuration figée, le flux d’événements, le résultat et les artefacts de correctifs.

```bash
do-code run --yes --output-format stream-json \
  --task-file task.txt --artifact-dir ./artifacts \
  --max-steps 40 --timeout 600
```

Utilisez `do-code acp` pour le protocole d’entrée/sortie standard ACP. Consultez le [protocole Headless / JSONL](docs/headless-protocol.md) pour le contrat d’automatisation pris en charge.

### Entrée d’images

Joignez jusqu’à quatre images PNG, JPEG, GIF ou WebP en répétant `--image` en mode headless. Le modèle sélectionné doit prendre en charge l’entrée d’images.

```bash
do-code run --image screenshots/bug.png --image screenshots/diagram.webp "Describe these images"
```

Dans la TUI interactive, saisissez `@path/to/image.png` ou utilisez `/paste-image` pour importer une image depuis le presse-papiers système. Utilisez `/remove-image <index|name>` pour supprimer une pièce jointe en attente. Chaque image est limitée à 10 MB et le prompt total à 20 MB. Les fichiers importés sont copiés vers `~/.local/share/do-code/projects/<project-key>/sessions/<session-id>/attachments/` ; les messages persistés ne contiennent que des références relatives telles que `attachments/image_xxx.png`, jamais de données Base64 ni le chemin absolu d’origine. Définissez `DO_CODE_DATA_DIR` pour remplacer la racine globale des données. Les données `.do-code` locales au projet existant sont migrées vers le répertoire de projet géré par l’utilisateur lors du prochain accès au projet.

### Commandes CLI utiles

```bash
do-code config show          # Inspecter la configuration effective du modèle
do-code doctor               # Vérifier le modèle, l’espace de travail et les outils locaux
do-code sessions list        # Lister les sessions du projet
do-code extensions           # Inspecter les commandes, compétences et la configuration MCP
do-code agents               # Lister les profils d’agent
do-code worktrees            # Lister les worktrees isolés
do-code errors list          # Lister les rapports d’erreur récents
```

## Sécurité et données

Le mode **Ask** par défaut demande une confirmation pour les actions à haut risque. **Auto** gère automatiquement les modifications ordinaires de l’espace de travail. **Full Access** est destiné uniquement aux espaces de travail de confiance ou à la CI.

La configuration est stockée sous `~/.config/do-code/` ; les sessions de projet, pièces jointes, points de contrôle et rapports d’erreur sont stockés sous `~/.local/share/do-code/projects/<project-key>/`. `DO_CODE_DATA_DIR` remplace la racine des données. Par défaut, les identifiants et les données du projet restent sur votre machine.

Les paramètres de sandbox peuvent utiliser une exécution locale, macOS Seatbelt ou un conteneur, selon la configuration et la prise en charge de l’hôte. Le mode d’autorisation et la configuration de sandbox sont des contrôles distincts.

Pour examiner un échec :

```bash
do-code errors list
do-code errors show <error-id>
```

## Documentation

- [Index de la documentation](docs/README.md)
- [Retour sur les cas problématiques et diagnostics](docs/bad-case-feedback.md)
- [Protocole Headless / JSONL](docs/headless-protocol.md)
- [Architecture](docs/architecture.md)
- [Développement local](docs/local-development.md)
- [Processus de publication personnelle](docs/releasing.md)

## Contribuer

Les problèmes et pull requests sont les bienvenus. Veuillez lire le [guide de contribution](CONTRIBUTING.md) et la [politique de sécurité](SECURITY.md) avant de soumettre une modification.

```bash
npm run verify:local
npm run build:agent
```

## Licence

[Apache-2.0](LICENSE)
