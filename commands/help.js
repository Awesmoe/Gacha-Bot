const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const games = require('../games');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('How to import your gacha pull history')
    .addStringOption(opt =>
      opt.setName('game')
        .setDescription('Which game')
        .setRequired(false)
        .addChoices(...games.choices())
    ),

  async execute(interaction) {
    const gameId = interaction.options.getString('game') || 'endfield';
    const game = games.get(gameId);

    if (!game) {
      return interaction.reply({ content: `Unknown game: ${gameId}`, ephemeral: true });
    }

    if (gameId === 'endfield') {
      const embed = new EmbedBuilder()
        .setTitle('How to Import — Arknights: Endfield')
        .setColor(0xdc2626)
        .setDescription(
          '**Step 1:** Open Arknights: Endfield and go to the **Headhunting Records** page (view your pull history for any banner).\n\n' +
          '**Step 2:** Open **PowerShell** on your PC and paste this command:\n' +
          '```powershell\n' +
		'$p="$env:LOCALAPPDATA\\PlatformProcess\\Cache\\data_1"; $c="$env:TEMP\\ef_cache.tmp"; if(Test-Path $p){Copy-Item $p $c -Force; $ms=[regex]::Matches([IO.File]::ReadAllText($c),\'token=([^&\\s]+)\'); if($ms.Count -gt 0){$ms[$ms.Count-1].Groups[1].Value|Set-Clipboard; echo "Token copied!"}else{echo "No token found"}}else{echo "Cache not found"}\n' +
          '```\n\n' +
          '**Step 3:** Use the command below to import (paste your token):\n' +
          '```\n/import game:endfield token:<paste here>\n```\n' +
          'Server ID defaults to `3` (global). Only set `server_id` if you play on a different server.\n\n' +
          '⚠️ Your token is **short-lived** (expires in hours) and **read-only** — it can only view pull history. It is never stored.'
        )
        .setFooter({ text: 'All responses are ephemeral — only you can see them' });

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (gameId === 'starrail') {
      const embed = new EmbedBuilder()
        .setTitle('How to Import — Honkai: Star Rail')
        .setColor(0x9ca3af)
        .setDescription(
          '**Step 1:** Open Honkai: Star Rail and go to the **Warp Records** page (view history for any banner).\n\n' +
          '**Step 2:** Open **PowerShell** on your PC and paste this command:\n' +
          '```powershell\n' +
          '$a=[Environment]::GetFolderPath(\'ApplicationData\'); $p=Get-Content "$a\\..\\LocalLow\\Cognosphere\\Star Rail\\Player.log" -First 11|Where-Object{$_ -match "Loading player data from "}|ForEach-Object{$_ -replace "Loading player data from ","" -replace "data.unity3d",""}; $v=Get-ChildItem "$p\\webCaches" -Dir|Where-Object{$_.Name -match \'^\\d+\\.\\d+\\.\\d+\\.\\d+$\'}|Sort-Object{[int]-join($_.Name.Split("."))} -Descending|Select-Object -First 1; $c="$env:TEMP\\hsr_cache.tmp"; Copy-Item "$p\\webCaches\\$($v.Name)\\Cache\\Cache_Data\\data_2" $c -Force; $t=[IO.File]::ReadAllText($c); $ms=[regex]::Matches($t,\'authkey=([^&\\s\\0]+)\'); if($ms.Count -gt 0){$ms[$ms.Count-1].Groups[1].Value|Set-Clipboard; echo "Authkey copied!"}else{echo "No authkey found"}\n' +
          '```\n\n' +
          '**Step 3:** Use the command below to import (paste your authkey):\n' +
          '```\n/import game:starrail token:<paste here>\n```\n\n' +
          '⚠️ Your authkey is **short-lived** (expires ~24h) and **read-only**. It is never stored.'
        )
        .setFooter({ text: 'All responses are ephemeral — only you can see them' });

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (gameId === 'genshin') {
      const embed = new EmbedBuilder()
        .setTitle('How to Import — Genshin Impact')
        .setColor(0x1a78c2)
        .setDescription(
          '**Step 1:** Open Genshin Impact and go to the **Wish History** page (open any banner and tap History).\n\n' +
          '**Step 2:** Open **PowerShell** on your PC and paste this command:\n' +
          '```powershell\n' +
          '$a=[Environment]::GetFolderPath(\'ApplicationData\'); $log="$a\\..\\LocalLow\\miHoYo\\Genshin Impact\\output_log.txt"; $l=Get-Content $log|Where-Object{$_ -match \'TelemetryInterface path:\'}|Select-Object -Last 1; $dp=[regex]::Match($l,\'path:(.+)\\\\SDKCaches\').Groups[1].Value; $v=Get-ChildItem "$dp\\webCaches" -Dir|Where-Object{$_.Name -match \'^\\d+\\.\\d+\\.\\d+\\.\\d+$\'}|Sort-Object{[int]-join($_.Name.Split("."))} -Descending|Select-Object -First 1; $c="$env:TEMP\\gi_cache.tmp"; Copy-Item "$dp\\webCaches\\$($v.Name)\\Cache\\Cache_Data\\data_2" $c -Force; $t=[IO.File]::ReadAllText($c); $ms=[regex]::Matches($t,\'authkey=([^&\\s\\0]+)\'); if($ms.Count -gt 0){$ms[$ms.Count-1].Groups[1].Value|Set-Clipboard; echo "Authkey copied!"}else{echo "No authkey found"}\n' +
          '```\n\n' +
          '**Step 3:** Use the command below to import (paste your authkey):\n' +
          '```\n/import game:genshin token:<paste here>\n```\n\n' +
          '⚠️ Your authkey is **short-lived** (expires ~24h) and **read-only**. It is never stored.'
        )
        .setFooter({ text: 'All responses are ephemeral — only you can see them' });

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (gameId === 'nikki') {
      const embed = new EmbedBuilder()
        .setTitle('How to Import — Infinity Nikki')
        .setColor(0xec4899)
        .setDescription(
          '**Step 1:** Log in at **https://pearpal.infoldgames.com** (Infold\'s account portal — same login as the game).\n\n' +
          '**Step 2:** Open your browser\'s **DevTools console** (F12 → Console tab) and paste this:\n' +
          '```js\n' +
          "console.log(JSON.stringify({roleid:[...document.querySelectorAll('div')].find(el=>el.textContent.startsWith('UID:'))?.textContent.replace('UID:','').trim(),token:document.cookie.match(/momoToken=([^;]+)/)?.[1],id:document.cookie.match(/momoNid=([^;]+)/)?.[1]}));\n" +
          '```\n' +
          'It prints a JSON object with three fields: `roleid`, `token`, `id`.\n\n' +
          '**Step 3:** Copy that whole JSON line and run:\n' +
          '```\n/import game:nikki token:<paste the JSON here>\n```\n' +
          'First import takes ~3–4 minutes (it walks every banner ever released).\n\n' +
          '⚠️ These are your **Pearpal session cookies** (expire after ~**7 days**) — treat them like a password. Anyone with them could sign in as you on Pearpal. The bot uses them once per import and never stores them.'
        )
        .setFooter({ text: 'All responses are ephemeral — only you can see them' });

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    return interaction.reply({ content: `Help for ${game.displayName} coming soon`, ephemeral: true });
  },
};
