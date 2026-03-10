# Panorama aquatique HDF

Dashboard web statique pour explorer un croisement de données publiques sur la filière aquatique en Hauts-de-France et le publier facilement sur GitHub Pages.

## Ce que contient le projet

- un script Python qui transforme le classeur Excel en `JSON` pour l'interface et en `CSV` pour les exports
- une interface React + Vite orientée lecture territoriale, filtres, carte, comparaisons et consultation des données brutes
- un workflow GitHub Actions prêt pour déployer le site sur GitHub Pages

## Lancer le projet

```bash
python -m pip install -r requirements.txt
npm install
npm run dev
```

Le script de données est exécuté automatiquement avant le serveur Vite.
Ne pas ouvrir `index.html` directement ni utiliser un serveur statique générique type Live Server : le projet doit être servi par Vite pour transpiler `src/main.tsx`.

## Mode Live Server

Si tu veux absolument utiliser l'extension VS Code Live Server :

```bash
npm run static
```

Puis dans VS Code :

1. ouvrir le dossier du projet
2. attendre la fin du build
3. lancer Live Server

Le workspace est configuré pour servir automatiquement le dossier `dist/` via `.vscode/settings.json`.

## Construire la version de production

```bash
npm run build
```

Les fichiers produits sont :

- `public/data/dashboard.json` pour le dashboard
- `public/data/exports/*.csv` et `data/exports/*.csv` pour les exports réutilisables
- `public/data/*.xlsx` pour le classeur source téléchargeable depuis l'interface
- `dist/` pour la version statique à publier

## Publication sur GitHub

1. Initialiser le dépôt : `git init`
2. Créer un dépôt GitHub et pousser la branche `main`
3. Dans GitHub, activer `Settings > Pages > Build and deployment > GitHub Actions`
4. Le workflow `.github/workflows/deploy.yml` publiera automatiquement le dashboard à chaque push sur `main`

## Source des données

Le dashboard s'appuie sur le classeur Excel présent à la racine du projet. Il croise des données publiques sur les licences FFN, les équipements aquatiques, les usages scolaires, les modes de gestion et les QPV. Les définitions métier sont reprises depuis l'onglet `00_Lisez_moi` et la table `11_Sources`.
