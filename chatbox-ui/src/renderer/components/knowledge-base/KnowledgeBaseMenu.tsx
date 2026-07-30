import { Button, Flex, Group, Menu, Text } from '@mantine/core'
import type { KnowledgeBase } from '@shared/types'
import { IconCheck, IconFile, IconSettings2 } from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useKnowledgeBases } from '@/hooks/knowledge-base'
import { DIFY_KNOWLEDGE_BASE_ID } from '@/packages/dify-knowledge'
import { useSettingsStore } from '@/stores/settingsStore'

type Props = {
  currentKnowledgeBaseId?: number
  children?: React.ReactNode
  onSelect?: (kb: KnowledgeBase | null) => void
  opened?: boolean
  setOpened?: (opened: boolean) => void
}

const KnowledgeBaseMenu: FC<Props> = (props) => {
  const { data: knowledgeBases } = useKnowledgeBases()
  const { t } = useTranslation()
  const difyKnowledge = useSettingsStore((state) => state.difyKnowledge)
  const difyAvailable = !!(
    difyKnowledge?.enabled &&
    (difyKnowledge.profileId?.trim() || (difyKnowledge.baseUrl.trim() && difyKnowledge.apiKey.trim()))
  )

  return (
    <Menu
      trigger="hover"
      openDelay={100}
      closeDelay={100}
      position="top"
      shadow="md"
      keepMounted
      // 使用动画延迟消失，保证点击后能看到选中状态
      transitionProps={{
        transition: 'pop',
        duration: 200,
      }}
    >
      <Menu.Target>{props.children}</Menu.Target>
      <Menu.Dropdown className="min-w-40">
        <Flex justify="space-between">
          <Menu.Label fw={600}>{t('Knowledge Base')}</Menu.Label>
          <Menu.Label>
            <Link to="/settings/knowledge-base">
              <IconSettings2 size={16} color="var(--chatbox-tint-tertiary)" />
            </Link>
          </Menu.Label>
        </Flex>
        {knowledgeBases?.map((kb) => (
          <Menu.Item key={kb.id} onClick={() => props.onSelect?.(kb)}>
            <Flex justify="space-between" align="center" gap="xs">
              <Flex gap="xs" align="center">
                <IconFile size={14} />
                <Text c={kb.id === props.currentKnowledgeBaseId ? 'chatbox-brand' : ''}>{kb.name}</Text>
              </Flex>
              {kb.id === props.currentKnowledgeBaseId && <IconCheck size={14} color="var(--chatbox-tint-brand)" />}
            </Flex>
          </Menu.Item>
        ))}
        {difyAvailable && (
          <Menu.Item
            onClick={() =>
              props.onSelect?.({
                id: DIFY_KNOWLEDGE_BASE_ID,
                name: difyKnowledge?.name || 'Dify 知识工作流',
                embeddingModel: '',
                rerankModel: '',
                providerMode: 'custom',
                createdAt: 0,
              })
            }
          >
            <Flex justify="space-between" align="center" gap="xs">
              <Flex gap="xs" align="center">
                <IconFile size={14} />
                <Text c={props.currentKnowledgeBaseId === DIFY_KNOWLEDGE_BASE_ID ? 'chatbox-brand' : ''}>
                  {difyKnowledge?.name || 'Dify 知识工作流'}
                </Text>
              </Flex>
              {props.currentKnowledgeBaseId === DIFY_KNOWLEDGE_BASE_ID && (
                <IconCheck size={14} color="var(--chatbox-tint-brand)" />
              )}
            </Flex>
          </Menu.Item>
        )}
        {knowledgeBases?.length === 0 && !difyAvailable && (
          <Group justify="center" className="w-full">
            <Link to="/settings/knowledge-base" className="w-full">
              <Button size="xs" variant="light" w="100%">
                <PlusIcon size={14} className="mr-1" />
                {t('Create')}
              </Button>
            </Link>
          </Group>
        )}
      </Menu.Dropdown>
    </Menu>
  )
}

export default KnowledgeBaseMenu
