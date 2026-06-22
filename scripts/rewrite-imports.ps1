$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path '.').Path
$srcRoot = Join-Path $repoRoot 'src'

# OLD path -> NEW path (both relative to repo, using forward slashes).
$moves = @{
  'src/engine/Engine.ts' = 'src/engine/core/Engine.ts'
  'src/engine/GameLoop.ts' = 'src/engine/core/GameLoop.ts'
  'src/engine/Time.ts' = 'src/engine/core/Time.ts'
  'src/engine/System.ts' = 'src/engine/core/System.ts'
  'src/engine/SceneManager.ts' = 'src/engine/core/SceneManager.ts'
  'src/engine/ResourceManager.ts' = 'src/engine/core/ResourceManager.ts'
  'src/engine/ServiceContainer.ts' = 'src/engine/core/ServiceContainer.ts'
  'src/engine/ServiceTokens.ts' = 'src/engine/core/ServiceTokens.ts'
  'src/engine/EventBus.ts' = 'src/engine/core/EventBus.ts'
  'src/engine/Input.ts' = 'src/engine/input/Input.ts'
  'src/engine/KeyBindings.ts' = 'src/engine/input/KeyBindings.ts'
  'src/engine/animation/BoneMapper.ts' = 'src/engine/animation/pose/BoneMapper.ts'
  'src/engine/animation/BoneRotation.ts' = 'src/engine/animation/pose/BoneRotation.ts'
  'src/engine/animation/HumanoidRestPose.ts' = 'src/engine/animation/pose/HumanoidRestPose.ts'
  'src/engine/animation/PoseSnapshot.ts' = 'src/engine/animation/pose/PoseSnapshot.ts'
  'src/engine/animation/RestPoseTuning.ts' = 'src/engine/animation/pose/RestPoseTuning.ts'
  'src/engine/animation/ProceduralCharacterAnimator.ts' = 'src/engine/animation/procedural/ProceduralCharacterAnimator.ts'
  'src/engine/animation/ProceduralWalk.ts' = 'src/engine/animation/procedural/ProceduralWalk.ts'
  'src/engine/animation/ProceduralBalance.ts' = 'src/engine/animation/procedural/ProceduralBalance.ts'
  'src/engine/animation/RagdollSystem.ts' = 'src/engine/animation/ragdoll/RagdollSystem.ts'
  'src/engine/animation/RagdollBuilder.ts' = 'src/engine/animation/ragdoll/RagdollBuilder.ts'
  'src/engine/animation/RagdollController.ts' = 'src/engine/animation/ragdoll/RagdollController.ts'
  'src/engine/animation/RagdollDefinition.ts' = 'src/engine/animation/ragdoll/RagdollDefinition.ts'
  'src/engine/animation/RagdollBodyPart.ts' = 'src/engine/animation/ragdoll/RagdollBodyPart.ts'
  'src/engine/animation/RagdollJointManager.ts' = 'src/engine/animation/ragdoll/RagdollJointManager.ts'
  'src/engine/animation/RagdollJointMotor.ts' = 'src/engine/animation/ragdoll/RagdollJointMotor.ts'
  'src/engine/animation/RagdollPoseDriver.ts' = 'src/engine/animation/ragdoll/RagdollPoseDriver.ts'
  'src/engine/animation/PhysicalBone.ts' = 'src/engine/animation/ragdoll/PhysicalBone.ts'
  'src/engine/animation/PhysicalJoint.ts' = 'src/engine/animation/ragdoll/PhysicalJoint.ts'
  'src/engine/animation/PhysicalSkeleton.ts' = 'src/engine/animation/ragdoll/PhysicalSkeleton.ts'
  'src/engine/animation/PhysicsBoneLink.ts' = 'src/engine/animation/ragdoll/PhysicsBoneLink.ts'
  'src/engine/render/Materials.ts' = 'src/engine/render/material/Materials.ts'
  'src/engine/render/Textures.ts' = 'src/engine/render/material/Textures.ts'
  'src/engine/render/LightingSystem.ts' = 'src/engine/render/environment/LightingSystem.ts'
  'src/engine/render/EnvironmentSystem.ts' = 'src/engine/render/environment/EnvironmentSystem.ts'
  'src/engine/render/Skybox.ts' = 'src/engine/render/environment/Skybox.ts'
  'src/engine/audio/AudioBus.ts' = 'src/engine/audio/core/AudioBus.ts'
  'src/engine/audio/AudioSystem.ts' = 'src/engine/audio/core/AudioSystem.ts'
  'src/engine/audio/SoundManager.ts' = 'src/engine/audio/core/SoundManager.ts'
  'src/engine/audio/PositionalSoundManager.ts' = 'src/engine/audio/core/PositionalSoundManager.ts'
  'src/engine/audio/MusicManager.ts' = 'src/engine/audio/core/MusicManager.ts'
  'src/engine/audio/BackgroundAmbienceSystem.ts' = 'src/engine/audio/systems/BackgroundAmbienceSystem.ts'
  'src/engine/audio/FootstepSoundSystem.ts' = 'src/engine/audio/systems/FootstepSoundSystem.ts'
  'src/engine/physics/CharacterController.ts' = 'src/engine/physics/character/CharacterController.ts'
  'src/engine/physics/CharacterMotor.ts' = 'src/engine/physics/character/CharacterMotor.ts'
  'src/engine/physics/KinematicCharacterBase.ts' = 'src/engine/physics/character/KinematicCharacterBase.ts'
  'src/engine/physics/SpawnValidator.ts' = 'src/engine/physics/character/SpawnValidator.ts'
  'src/game/gameplay/Player.ts' = 'src/game/gameplay/player/Player.ts'
  'src/game/gameplay/PlayerHealth.ts' = 'src/game/gameplay/player/PlayerHealth.ts'
  'src/game/gameplay/Stamina.ts' = 'src/game/gameplay/player/Stamina.ts'
  'src/game/gameplay/Controls.ts' = 'src/game/gameplay/player/Controls.ts'
  'src/game/gameplay/weapons/Weapon.ts' = 'src/game/gameplay/weapons/core/Weapon.ts'
  'src/game/gameplay/weapons/WeaponDefinition.ts' = 'src/game/gameplay/weapons/core/WeaponDefinition.ts'
  'src/game/gameplay/weapons/WeaponController.ts' = 'src/game/gameplay/weapons/core/WeaponController.ts'
  'src/game/gameplay/weapons/WeaponFactory.ts' = 'src/game/gameplay/weapons/core/WeaponFactory.ts'
  'src/game/gameplay/weapons/WeaponInventory.ts' = 'src/game/gameplay/weapons/core/WeaponInventory.ts'
  'src/game/gameplay/weapons/HitscanWeapon.ts' = 'src/game/gameplay/weapons/types/HitscanWeapon.ts'
  'src/game/gameplay/weapons/MeleeWeapon.ts' = 'src/game/gameplay/weapons/types/MeleeWeapon.ts'
  'src/game/gameplay/weapons/GravityGunWeapon.ts' = 'src/game/gameplay/weapons/types/GravityGunWeapon.ts'
  'src/game/gameplay/weapons/MuzzleFlash.ts' = 'src/game/gameplay/weapons/effects/MuzzleFlash.ts'
  'src/game/gameplay/weapons/Recoil.ts' = 'src/game/gameplay/weapons/effects/Recoil.ts'
  'src/game/gameplay/weapons/WeaponEffects.ts' = 'src/game/gameplay/weapons/effects/WeaponEffects.ts'
  'src/game/gameplay/weapons/WeaponViewModel.ts' = 'src/game/gameplay/weapons/effects/WeaponViewModel.ts'
  'src/game/gameplay/weapons/WeaponPickup.ts' = 'src/game/gameplay/weapons/pickup/WeaponPickup.ts'
  'src/game/levels/DemoLevel.ts' = 'src/game/levels/maps/DemoLevel.ts'
  'src/game/levels/SnowFieldLevel.ts' = 'src/game/levels/maps/SnowFieldLevel.ts'
  'src/game/npc/NPC.ts' = 'src/game/npc/core/NPC.ts'
  'src/game/npc/NPCState.ts' = 'src/game/npc/core/NPCState.ts'
  'src/game/npc/INpc.ts' = 'src/game/npc/core/INpc.ts'
  'src/game/npc/NpcDebugFlags.ts' = 'src/game/npc/core/NpcDebugFlags.ts'
  'src/game/npc/AlyxNpc.ts' = 'src/game/npc/alyx/AlyxNpc.ts'
  'src/game/npc/CombineNpc.ts' = 'src/game/npc/combine/CombineNpc.ts'
  'src/game/npc/CombineRoleTuning.ts' = 'src/game/npc/combine/CombineRoleTuning.ts'
  'src/game/npc/NpcCombat.ts' = 'src/game/npc/combat/NpcCombat.ts'
  'src/game/npc/NpcRangedCombat.ts' = 'src/game/npc/combat/NpcRangedCombat.ts'
  'src/game/npc/NpcWeaponAttachment.ts' = 'src/game/npc/combat/NpcWeaponAttachment.ts'
  'src/game/npc/WeaponAttachmentTuning.ts' = 'src/game/npc/combat/WeaponAttachmentTuning.ts'
  'src/game/npc/CombatSquadCoordinator.ts' = 'src/game/npc/combat/CombatSquadCoordinator.ts'
  'src/game/npc/NpcSteering.ts' = 'src/game/npc/movement/NpcSteering.ts'
  'src/game/npc/NpcPathFollower.ts' = 'src/game/npc/movement/NpcPathFollower.ts'
  'src/game/npc/NpcAnimationBridge.ts' = 'src/game/npc/animation/NpcAnimationBridge.ts'
  'src/game/npc/NpcBarker.ts' = 'src/game/npc/voice/NpcBarker.ts'
  'src/game/ui/HUD.ts' = 'src/game/ui/hud/HUD.ts'
  'src/game/ui/HUDView.ts' = 'src/game/ui/hud/HUDView.ts'
  'src/game/ui/Crosshair.ts' = 'src/game/ui/hud/Crosshair.ts'
  'src/game/ui/DamageIndicator.ts' = 'src/game/ui/hud/DamageIndicator.ts'
  'src/game/ui/HealthArmorHUD.ts' = 'src/game/ui/hud/HealthArmorHUD.ts'
  'src/game/ui/HudIcons.ts' = 'src/game/ui/hud/HudIcons.ts'
  'src/game/ui/WeaponHUD.ts' = 'src/game/ui/hud/WeaponHUD.ts'
  'src/game/ui/WeaponSelectorView.ts' = 'src/game/ui/hud/WeaponSelectorView.ts'
  'src/game/ui/Subtitles.ts' = 'src/game/ui/subtitles/Subtitles.ts'
  'src/game/ui/SubtitlesView.ts' = 'src/game/ui/subtitles/SubtitlesView.ts'
  'src/game/ui/DebugOverlay.ts' = 'src/game/ui/overlay/DebugOverlay.ts'
  'src/game/ui/AimDebugPanel.ts' = 'src/game/ui/overlay/AimDebugPanel.ts'
  'src/game/ui/InteractionPrompt.ts' = 'src/game/ui/overlay/InteractionPrompt.ts'
  'src/game/ui/PauseMenu.ts' = 'src/game/ui/menu/PauseMenu.ts'
}

function Normalize-Path([string]$p) { return $p -replace '\\','/' }

function Resolve-Absolute([string]$baseDir, [string]$rel) {
  $combined = Join-Path $baseDir $rel
  $abs = [System.IO.Path]::GetFullPath($combined)
  return $abs
}

function To-RepoRelative([string]$abs) {
  $rel = $abs.Substring($repoRoot.Length).TrimStart('\','/')
  return Normalize-Path $rel
}

function To-AliasPath([string]$repoRel) {
  # repoRel like "src/engine/core/Foo.ts"
  if ($repoRel.StartsWith('src/engine/')) {
    return '@engine/' + ($repoRel.Substring('src/engine/'.Length) -replace '\.ts$','')
  }
  if ($repoRel.StartsWith('src/game/')) {
    return '@game/' + ($repoRel.Substring('src/game/'.Length) -replace '\.ts$','')
  }
  if ($repoRel.StartsWith('src/shared/')) {
    return '@shared/' + ($repoRel.Substring('src/shared/'.Length) -replace '\.ts$','')
  }
  return $null
}

# Invert moves to find old path from new path
$inverseMoves = @{}
foreach ($k in $moves.Keys) { $inverseMoves[$moves[$k]] = $k }

$tsFiles = Get-ChildItem -Recurse $srcRoot -Filter '*.ts' -File
$totalChanged = 0
$totalImports = 0

foreach ($file in $tsFiles) {
  $absFile = $file.FullName
  $repoRel = To-RepoRelative $absFile

  # OLD path of this importer (where it was BEFORE the move, so we resolve relative imports correctly)
  if ($inverseMoves.ContainsKey($repoRel)) {
    $oldRepoRel = $inverseMoves[$repoRel]
  } else {
    $oldRepoRel = $repoRel
  }
  $oldAbsFile = Join-Path $repoRoot $oldRepoRel
  $oldDir = Split-Path -Parent $oldAbsFile
  $newDir = Split-Path -Parent $absFile

  $content = Get-Content -Raw -LiteralPath $absFile

  $newContent = [regex]::Replace($content, "from\s+([`"'])(\.\.?/[^`"']+)\1", {
    param($m)
    $script:totalImports++
    $quote = $m.Groups[1].Value
    $rel = $m.Groups[2].Value

    # Resolve against OLD importer dir to determine the target file (pre-move)
    $absTargetOld = Resolve-Absolute $oldDir $rel
    $absTargetOldNoExt = $absTargetOld
    if (-not $absTargetOldNoExt.EndsWith('.ts')) { $absTargetOldNoExt = $absTargetOldNoExt + '.ts' }
    $oldTargetRepoRel = To-RepoRelative $absTargetOldNoExt

    # Has this target moved?
    if ($moves.ContainsKey($oldTargetRepoRel)) {
      $newTargetRepoRel = $moves[$oldTargetRepoRel]
    } else {
      $newTargetRepoRel = $oldTargetRepoRel
    }

    # Compute absolute NEW target path
    $newTargetAbs = Join-Path $repoRoot $newTargetRepoRel
    $newTargetDir = Split-Path -Parent $newTargetAbs
    $newTargetName = [System.IO.Path]::GetFileNameWithoutExtension($newTargetAbs)

    # Same-directory after move? Keep as ./Name
    if ([System.IO.Path]::GetFullPath($newTargetDir) -eq [System.IO.Path]::GetFullPath($newDir)) {
      return "from $quote./$newTargetName$quote"
    }

    # Otherwise use alias
    $alias = To-AliasPath $newTargetRepoRel
    if ($null -eq $alias) {
      # Shouldn't happen within src/, fall back to original (will probably break)
      return $m.Value
    }
    return "from $quote$alias$quote"
  })

  if ($newContent -ne $content) {
    Set-Content -LiteralPath $absFile -Value $newContent -NoNewline -Encoding UTF8
    $totalChanged++
  }
}

Write-Output "Files changed: $totalChanged"
Write-Output "Imports inspected: $totalImports"
