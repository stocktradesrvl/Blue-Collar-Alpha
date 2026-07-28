"""Persistent Discord gateway bot for message commands (!stats, !leaderboard).

Runs in-process as an asyncio task started from the FastAPI app. Reuses the
existing subscriber-server bot token. Requires the "Message Content Intent" to
be enabled for the bot in the Discord Developer Portal.
"""
import logging
import discord

logger = logging.getLogger("discord_bot")


def build_client(db, compute_stats, compute_leaderboard):
    intents = discord.Intents.default()
    intents.message_content = True
    client = discord.Client(intents=intents)

    @client.event
    async def on_ready():
        logger.info("Discord bot connected as %s", client.user)

    @client.event
    async def on_message(message):
        try:
            if message.author.bot:
                return
            content = (message.content or "").strip().lower()

            if content.startswith("!stats"):
                u = await db.users.find_one({"discord_id": str(message.author.id)})
                if not u:
                    await message.channel.send(
                        "You haven't linked your account yet. Open **Blue Collar Alpha → Profile → Discord** and tap *Link Discord*.")
                    return
                s = await compute_stats(u["id"], u.get("account_balance", 10000))
                if s["total_trades"] == 0:
                    await message.channel.send("No trades logged yet — add a trade in the app to build your stats. 📈")
                    return
                embed = discord.Embed(title="📊 Your Trading Stats", color=0x2E76E8)
                embed.add_field(name="Trades", value=str(s["total_trades"]))
                embed.add_field(name="Win Rate", value=f"{s['win_rate']}%")
                embed.add_field(name="Total P&L", value=f"${s['total_pnl']:,.2f}")
                embed.add_field(name="Profit Factor", value=str(s["profit_factor"]))
                embed.add_field(name="Avg Winner", value=f"${s['avg_winner']:,.2f}")
                embed.add_field(name="Avg Loser", value=f"${s['avg_loser']:,.2f}")
                if s.get("best_setup"):
                    embed.add_field(name="Best Setup", value=str(s["best_setup"]), inline=False)
                embed.set_footer(text="Blue Collar Alpha · !stats")
                await message.channel.send(embed=embed)

            elif content.startswith("!leaderboard"):
                data = await compute_leaderboard(30, 10)
                entries = data.get("entries", [])
                if not entries:
                    await message.channel.send(
                        "No one is on the leaderboard yet. Opt in via **Profile → Discord → Join leaderboard** (needs 3+ trades in the last 30 days).")
                    return
                medals = ["🥇", "🥈", "🥉"]
                lines = []
                for i, e in enumerate(entries):
                    rank = medals[i] if i < 3 else f"`#{i+1}`"
                    lines.append(f"{rank} **{e['alias']}** — ${e['pnl']:,.2f} · {e['win_rate']}% WR · {e['trades']} trades")
                embed = discord.Embed(title="🏆 30-Day Leaderboard (anonymized)",
                                      description="\n".join(lines), color=0xF5A623)
                embed.set_footer(text="Blue Collar Alpha · !leaderboard · opt in from the app")
                await message.channel.send(embed=embed)
        except Exception as e:
            logger.error("discord bot on_message err: %s", e)

    return client
