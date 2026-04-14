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
        .setColor(0xf59e0b)
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
        .setColor(0x7b68ee)
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

    return interaction.reply({ content: `Help for ${game.displayName} coming soon`, ephemeral: true });
  },
};
