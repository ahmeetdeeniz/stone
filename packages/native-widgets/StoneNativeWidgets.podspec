require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |spec|
  spec.name = 'StoneNativeWidgets'
  spec.version = package['version']
  spec.summary = 'Stone native widget snapshot bridge'
  spec.description = 'Device-local bridge for Stone WidgetKit and ActivityKit surfaces.'
  spec.license = package['license']
  spec.author = 'Stone contributors'
  spec.homepage = 'https://github.com/'
  spec.platforms = { :ios => '16.1' }
  spec.swift_version = '5.9'
  spec.source = { :path => '.' }
  spec.source_files = 'ios/StoneWidgetsModule.swift'
  spec.frameworks = 'ActivityKit', 'WidgetKit'
  spec.dependency 'ExpoModulesCore'
end
