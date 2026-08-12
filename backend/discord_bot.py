"""Persistent Discord gateway bot for message commands (!stats, !leaderboard).

Runs in-process as an asyncio task started from the FastAPI app. Reuses the
existing subscriber-server bot token. Requires the "Message Content Intent" to
be enabled for the bot in the Discord Developer Portal.
"""
import logging
import discord

logger = logging.getLogger("discord_bot")


def build_client(db, compute_stats, compute_leaderboard, gex_summary=None):
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

            elif content.startswith("!gex"):
                if gex_summary is None:
                    await message.channel.send("GEX data isn't available right now.")
                    return
                parts = (message.content or "").strip().split()
                sym = parts[1].upper() if len(parts) > 1 else "SPY"
                g = await gex_summary(sym)
                if g.get("error"):
                    await message.channel.send(g["error"])
                    return
                if g.get("empty"):
                    await message.channel.send(f"No GEX data logged for **{g['symbol']}** yet. Check back once today's levels are ingested. 📊")
                    return
                pos = g["regime"].startswith("Positive")
                emb = discord.Embed(
                    title=f"📊 {g['symbol']} Gamma Regime",
                    description=f"**{g['regime']}**\n{g['implication']}",
                    color=0x22C55E if pos else 0xEF4444)
                if g.get("spot") is not None:
                    emb.add_field(name="Spot", value=f"{g['spot']:,.2f}")
                if g.get("flip_point") is not None:
                    emb.add_field(name="Gamma Flip", value=f"{g['flip_point']:,.2f}")
                if g.get("call_wall") is not None:
                    emb.add_field(name="Call Wall", value=f"{g['call_wall']:,.2f}")
                if g.get("put_wall") is not None:
                    emb.add_field(name="Put Wall", value=f"{g['put_wall']:,.2f}")
                emb.set_footer(text="Blue Collar Alpha · !gex SPY|SPX|XSP · not financial advice")
                await message.channel.send(embed=emb)
        except Exception as e:
            logger.error("discord bot on_message err: %s", e)

    return client
