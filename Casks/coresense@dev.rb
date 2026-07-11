# Homebrew cask for CoreSense (development / prerelease channel). `version` +
# `sha256` are auto-managed on each PRERELEASE by
# .github/workflows/homebrew-cask.yml (via scripts/update-cask.mjs); edit those
# two lines by hand only as a fallback. Install with:
#   brew tap andyshinn/coresense https://github.com/andyshinn/coresense
#   brew install --cask coresense@dev
cask "coresense@dev" do
  version "0.0.12-dev.6"
  sha256 "14ae00d939c6dae2ee690cc94cfd590ea7057ba139e9815949c435cb47e42e5c"

  url "https://github.com/andyshinn/coresense/releases/download/v#{version}/CoreSense-#{version}-universal.dmg"
  name "CoreSense"
  desc "Experimental desktop MeshCore client (development builds)"
  homepage "https://github.com/andyshinn/coresense"

  livecheck do
    url :url
    strategy :github_releases
  end

  conflicts_with cask: "coresense"
  depends_on macos: :big_sur

  app "CoreSense.app"

  zap trash: [
    "~/Library/Application Support/CoreSense",
    "~/Library/Caches/com.electron.coresense",
    "~/Library/Caches/com.electron.coresense.ShipIt",
    "~/Library/Preferences/com.electron.coresense.plist",
    "~/Library/Saved Application State/com.electron.coresense.savedState",
  ]
end
