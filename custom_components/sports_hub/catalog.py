"""Curated major competitions. Provider paths are verified by scripts/probe.py."""

SPORTS = {
    "soccer": ("Football", "Fußball", "mdi:soccer"),
    "basketball": ("Basketball", "Basketball", "mdi:basketball"),
    "football": ("American football", "Football", "mdi:football"),
    "hockey": ("Ice hockey", "Eishockey", "mdi:hockey-puck"),
    "baseball": ("Baseball", "Baseball", "mdi:baseball"),
    "tennis": ("Tennis", "Tennis", "mdi:tennis"),
    "racing": ("Motorsport", "Motorsport", "mdi:flag-checkered"),
    "golf": ("Golf", "Golf", "mdi:golf"),
    "mma": ("MMA", "MMA", "mdi:karate"),
    "australian-football": ("Australian football", "Australian Football", "mdi:football-australian"),
}

_COMPETITIONS = {
    "soccer": [
        ("ger.1", "Bundesliga", "DE"),
        ("ger.2", "2. Bundesliga", "DE"),
        ("ger.dfb_pokal", "DFB-Pokal", "DE"),
        ("eng.1", "Premier League", "GB"),
        ("eng.2", "Championship", "GB"),
        ("eng.fa", "FA Cup", "GB"),
        ("eng.league_cup", "EFL Cup", "GB"),
        ("esp.1", "LaLiga", "ES"),
        ("esp.copa_del_rey", "Copa del Rey", "ES"),
        ("ita.1", "Serie A", "IT"),
        ("ita.coppa_italia", "Coppa Italia", "IT"),
        ("fra.1", "Ligue 1", "FR"),
        ("fra.coupe_de_france", "Coupe de France", "FR"),
        ("ned.1", "Eredivisie", "NL"),
        ("por.1", "Primeira Liga", "PT"),
        ("bel.1", "Belgian Pro League", "BE"),
        ("aut.1", "Austrian Bundesliga", "AT"),
        ("sco.1", "Scottish Premiership", "GB"),
        ("tur.1", "Süper Lig", "TR"),
        ("uefa.champions", "Champions League", "EU"),
        ("uefa.europa", "Europa League", "EU"),
        ("uefa.europa.conf", "Conference League", "EU"),
        ("uefa.nations", "Nations League", "EU"),
        ("uefa.euro", "EURO", "EU"),
        ("fifa.world", "FIFA World Cup", "WORLD"),
        ("fifa.wwc", "FIFA Women's World Cup", "WORLD"),
        ("fifa.worldq.uefa", "European World Cup Qualifiers", "EU"),
        ("eng.w.1", "Women's Super League", "GB"),
        ("esp.w.1", "Liga F", "ES"),
        ("uefa.wchampions", "Women's Champions League", "EU"),
        ("usa.1", "MLS", "US"),
        ("usa.nwsl", "NWSL", "US"),
        ("conmebol.libertadores", "Copa Libertadores", "SA"),
        ("bra.1", "Brasileirão", "BR"),
        ("arg.1", "Argentine Primera División", "AR"),
        ("mex.1", "Liga MX", "MX"),
        ("jpn.1", "J1 League", "JP"),
        ("ksa.1", "Saudi Pro League", "SA"),
    ],
    "basketball": [
        ("nba", "NBA", "US"), ("wnba", "WNBA", "US"),
        ("mens-college-basketball", "NCAA Men's Basketball", "US"),
        ("womens-college-basketball", "NCAA Women's Basketball", "US"),
        ("nbl", "NBL", "AU"),
    ],
    "football": [("nfl", "NFL", "US"), ("college-football", "NCAA Football", "US")],
    "hockey": [("nhl", "NHL", "US")],
    "baseball": [("mlb", "MLB", "US")],
    "tennis": [("atp", "ATP Tour", "WORLD"), ("wta", "WTA Tour", "WORLD")],
    "racing": [
        ("f1", "Formula 1", "WORLD"), ("irl", "IndyCar", "US"),
        ("nascar-premier", "NASCAR Cup", "US"),
        ("nascar-secondary", "NASCAR O'Reilly Auto Parts Series", "US"),
        ("nascar-truck", "NASCAR Truck Series", "US"),
    ],
    "golf": [
        ("pga", "PGA Tour", "WORLD"), ("lpga", "LPGA Tour", "WORLD"),
        ("eur", "DP World Tour", "WORLD"), ("liv", "LIV Golf", "WORLD"),
    ],
    "mma": [("ufc", "UFC", "WORLD")],
    "australian-football": [("afl", "AFL", "AU")],
}

LEAGUES = {
    f"{sport}:{path}": {
        "id": f"{sport}:{path}", "sport": sport, "path": path,
        "name": name, "region": region, "icon": SPORTS[sport][2],
    }
    for sport, competitions in _COMPETITIONS.items()
    for path, name, region in competitions
}
DEFAULT_LEAGUES = list(LEAGUES)


def selected_leagues(values):
    """Keep only known, unique competition IDs, preserving catalog order."""
    chosen = set(values)
    return [key for key in LEAGUES if key in chosen]
