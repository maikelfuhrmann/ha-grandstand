"""No home-location fallback, misleading stadium match or invalid coordinates."""
import unittest
from unittest.mock import AsyncMock
from types import SimpleNamespace
from custom_components.sports_hub.venue import coordinates, venue_location, photon_location, resolve_venue


def feature(name='Signal Iduna Park',kind='stadium',lat=51.49249,lon=7.45185):
    return {'properties':{'name':name,'osm_key':'leisure','osm_value':kind,'country':'Germany','city':'Dortmund'},'geometry':{'coordinates':[lon,lat]}}


class VenueTest(unittest.TestCase):
    def test_coordinate_bounds_and_missing_are_not_zero(self):
        for lat,lon in [(None,1),('',1),(True,1),('nan',1),(91,0),(0,181)]:self.assertIsNone(coordinates(lat,lon))
        self.assertEqual(coordinates('0','-46.7'),{'latitude':0.,'longitude':-46.7})
    def test_venue_metadata_preserves_actual_match_location(self):
        place=venue_location({'fullName':'Away stadium','address':{'city':'Away city','country':'Germany'},'coordinates':{'latitude':50,'longitude':8}})
        self.assertEqual(place['name'],'Away stadium');self.assertEqual(place['latitude'],50)
    def test_wrong_provider_city_does_not_override_exact_stadium(self):
        place=photon_location({'features':[feature(kind='station'),feature()]},{'name':'SIGNAL IDUNA PARK','city':'Aue','country':'Germany'})
        self.assertEqual(place['city'],'Dortmund')
    def test_fuzzy_name_other_country_and_ambiguous_stadium_rejected(self):
        venue={'name':'Signal Iduna Park','country':'Germany'}
        self.assertIsNone(photon_location({'features':[feature('Other park')]},venue))
        self.assertIsNone(photon_location({'features':[feature()]},{**venue,'country':'France'}))
        self.assertIsNone(photon_location({'features':[feature(),feature(lat=52)]},venue))


class VenueLookup(unittest.IsolatedAsyncioTestCase):
    async def test_valid_source_coordinates_do_not_trigger_geocoding(self):
        provider=SimpleNamespace(get=AsyncMock())
        point=await resolve_venue(provider,{'latitude':0,'longitude':0,'name':'Venue'})
        self.assertEqual(point['source'],'ESPN');provider.get.assert_not_awaited()
    async def test_unknown_venue_and_failure_do_not_fall_back_to_home(self):
        provider=SimpleNamespace(get=AsyncMock(return_value={'error':True,'data':{}}))
        self.assertIsNone(await resolve_venue(provider,{}))
        self.assertIsNone(await resolve_venue(provider,{'name':'A','country':'Germany'}))
