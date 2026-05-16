{
  "Servers": {
    "1": {
      "Name": "SSO GEMMATEX (local)",
      "Group": "Servers",
      "Host": "@@DB_HOST@@",
      "Port": @@DB_PORT@@,
      "MaintenanceDB": "@@DB_NAME@@",
      "Username": "@@DB_USER@@",
      "SSLMode": "prefer",
      "PassFile": "/tmp/pgpass",
      "ConnectNow": true
    }
  }
}
