# Skills

Agent skills for Claude Code and Codex. Each folder is one self-contained skill, with a `SKILL.md` that tells the agent when and how to use it.

| Skill | What it does | Requires |
|---|---|---|
| [`kaggle-notebooks`](kaggle-notebooks/SKILL.md) | Drives the Kaggle notebook editor through a CLI, so the agent doesn't need to read the page: edit and run notebooks, switch GPU or TPU, run shell commands in a live session, and monitor resources and quota | macOS, Google Chrome, Node.js 20+, a Kaggle account. The quota check also needs the official [Kaggle CLI](https://github.com/Kaggle/kaggle-cli) |

## Install

Get the repo:

```bash
git clone https://github.com/alpharomercoma/skills.git
cd skills
```

Then copy the skill to where your agent looks for it, and install its dependency.

**Claude Code**

```bash
mkdir -p ~/.claude/skills
cp -R kaggle-notebooks ~/.claude/skills/
npm install --prefix ~/.claude/skills/kaggle-notebooks
```

**Codex**

```bash
mkdir -p ~/.agents/skills
cp -R kaggle-notebooks ~/.agents/skills/
npm install --prefix ~/.agents/skills/kaggle-notebooks
```

**Both:** install it for Claude Code as above, then link it so there's only one copy to update:

```bash
mkdir -p ~/.agents/skills
ln -s ~/.claude/skills/kaggle-notebooks ~/.agents/skills/kaggle-notebooks
```

Start a new session afterwards, because agents load their skill list at startup.

To update, run `git pull` and repeat the copy and `npm install` steps.

## Use

Ask for what you want in plain language, and the agent picks the skill when it fits:

> Create a Kaggle notebook, run train.py on a T4 GPU, and tell me the final accuracy.

To name a skill directly, type `/kaggle-notebooks` in Claude Code or `$kaggle-notebooks` in Codex.

### First run of `kaggle-notebooks`

The first time, the agent opens a separate Chrome window on the Kaggle sign-in page. **Sign in there yourself.** The login is kept in its own profile at `~/.kaggle-agent/chrome-profile`, so you only do this once, and your everyday Chrome isn't touched.

Any program on your computer can control that window while it's open, so don't sign in to anything else there.

The skill works in your real Kaggle account, including your GPU quota. It's an unofficial tool that relies on Kaggle's current web interface, so a Kaggle redesign can break it. `SKILL.md` covers how to find and fix what changed.

## License

[MIT](LICENSE)
