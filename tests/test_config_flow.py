"""Validate configuration against the actual Home Assistant selector/schema API."""
import unittest
from custom_components.sports_hub.catalog import DEFAULT_LEAGUES
from custom_components.sports_hub.config_flow import schema, clean_input

class ConfigTests(unittest.TestCase):
    def test_defaults_select_catalog_and_valid_window(self):
        values=clean_input(schema({})({}))
        self.assertEqual(values['leagues'],DEFAULT_LEAGUES)
        self.assertEqual(values['days_ahead'],7)
        self.assertEqual(values['days_back'],2)

    def test_out_of_bounds_window_rejected(self):
        with self.assertRaises(Exception):schema({})({'leagues':['soccer:ger.1'],'days_ahead':365,'days_back':2})

    def test_unknown_competition_rejected(self):
        with self.assertRaises(Exception):schema({})({'leagues':['unknown'],'days_ahead':7,'days_back':2})

if __name__=='__main__':unittest.main()
